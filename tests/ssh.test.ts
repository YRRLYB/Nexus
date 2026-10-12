import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, utils, type Client } from 'ssh2';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { connectSSH, executeSSH, withSFTP, listSFTP } from '../electron/ssh';
import { previewSFTP } from '../electron/preview';
import { TEXT_PREVIEW_BYTES } from '../shared/preview';
import type { Device, TransferConflict, ConflictDecision } from '../shared/types';
import { Sessions } from '../electron/sessions';
import { Transfers } from '../electron/transfers';
import { Deployments, PREFLIGHT_COMMAND } from '../electron/deployment';
import { checkedEnvironment } from './fixtures/operations';
const { STATUS_CODE } = utils.sftp;
test('real SSH/SFTP protocol: trust, auth, command errors, browse, transfer and file mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-sftp-'));
  const downloads = await mkdtemp(join(tmpdir(), 'nexus-transfer-'));
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey;
  let installExit = 0;
  let installed = false;
  let changedEnvironment = false;
  const installedScripts: string[] = [];
  let shellInput = '';
  let resized = false;
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'test' && ctx.password === 'fixture-pass')
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept());
        session.on('window-change', (accept) => {
          resized = true;
          accept?.();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write(Buffer.from('你好 shell\r\n').subarray(0, 2));
          stream.write(Buffer.from('你好 shell\r\n').subarray(2));
          stream.on('data', (data: Buffer) => {
            shellInput += data.toString();
            stream.write('echo:' + data.toString());
          });
        });
        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          if (info.command === PREFLIGHT_COMMAND) {
            stream.write(
              checkedEnvironment({
                distribution: changedEnvironment ? 'ubuntu' : 'debian',
                docker: installed ? '1' : '0',
              }),
            );
            stream.exit(0);
          } else if (info.command.includes('mktemp -d /tmp/nexus-deploy')) {
            const temporary = '/tmp/nexus-deploy.TEST' + installedScripts.length;
            fs.mkdirSync(join(root, temporary), { recursive: true });
            stream.write(temporary + '\n');
            stream.exit(0);
          } else if (
            info.command.includes('installer.sh') &&
            info.command.includes('Checking installation')
          ) {
            const installer = fs
              .readdirSync(join(root, 'tmp'))
              .find((name) => fs.existsSync(join(root, 'tmp', name, 'installer.sh')))!;
            installedScripts.push(
              fs.readFileSync(join(root, 'tmp', installer, 'installer.sh'), 'utf8'),
            );
            assert.match(info.command, /docker version|x-ui.service/);
            stream.write('fixture installation\n');
            stream.exit(installExit);
          } else if (info.command === 'success') {
            stream.write('fixture output');
            stream.exit(0);
          } else {
            stream.stderr.write('permission denied');
            stream.exit(1);
          }
          stream.end();
        });
        session.on('sftp', (accept) => {
          const sftp = accept();
          const handles = new Map<number, { fd?: number; directory?: string; read?: boolean }>();
          let next = 1;
          const path = (p: string) => {
            const target = resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
            if (relative(root, target).startsWith('..')) throw new Error('outside root');
            return target;
          };
          const reply = (id: number, action: () => void) => {
            try {
              action();
            } catch (e) {
              sftp.status(
                id,
                (e as NodeJS.ErrnoException).code === 'ENOENT'
                  ? STATUS_CODE.NO_SUCH_FILE
                  : STATUS_CODE.FAILURE,
              );
            }
          };
          const handle = (id: number, value: { fd?: number; directory?: string }) => {
            const key = next++;
            handles.set(key, value);
            const buffer = Buffer.alloc(4);
            buffer.writeUInt32BE(key);
            sftp.handle(id, buffer);
          };
          const attrs = (p: string) => {
            const s = fs.lstatSync(p);
            return {
              mode: s.mode,
              uid: 0,
              gid: 0,
              size: s.size,
              atime: Math.floor(s.atimeMs / 1000),
              mtime: Math.floor(s.mtimeMs / 1000),
            };
          };
          sftp.on('REALPATH', (id, p) =>
            reply(id, () => {
              const resolved = path(p);
              fs.statSync(resolved);
              sftp.name(id, [
                {
                  filename: '/' + relative(root, resolved).replaceAll('\\', '/'),
                  longname: '',
                  attrs: attrs(resolved),
                },
              ]);
            }),
          );
          sftp.on('STAT', (id, p) => reply(id, () => sftp.attrs(id, attrs(path(p)))));
          sftp.on('LSTAT', (id, p) => reply(id, () => sftp.attrs(id, attrs(path(p)))));
          sftp.on('FSTAT', (id, h) =>
            reply(id, () => {
              const s = fs.fstatSync(handles.get(h.readUInt32BE())!.fd!);
              sftp.attrs(id, { size: s.size, mode: s.mode, uid: 0, gid: 0, atime: 0, mtime: 0 });
            }),
          );
          sftp.on('OPENDIR', (id, p) =>
            reply(id, () => {
              fs.readdirSync(path(p));
              handle(id, { directory: path(p) });
            }),
          );
          sftp.on('READDIR', (id, h) =>
            reply(id, () => {
              const item = handles.get(h.readUInt32BE())!;
              if (item.read) {
                sftp.status(id, STATUS_CODE.EOF);
                return;
              }
              item.read = true;
              const files = fs.readdirSync(item.directory!).map((name) => ({
                filename: name,
                longname: name,
                attrs: attrs(join(item.directory!, name)),
              }));
              if (files.length) sftp.name(id, files);
              else sftp.status(id, STATUS_CODE.EOF);
            }),
          );
          sftp.on('OPEN', (id, p, flags) =>
            reply(id, () =>
              handle(id, { fd: fs.openSync(path(p), utils.sftp.flagsToString(flags) || 'r') }),
            ),
          );
          sftp.on('READ', (id, h, offset, length) =>
            reply(id, () => {
              const buffer = Buffer.alloc(length);
              const n = fs.readSync(handles.get(h.readUInt32BE())!.fd!, buffer, 0, length, offset);
              if (n) sftp.data(id, buffer.subarray(0, n));
              else sftp.status(id, STATUS_CODE.EOF);
            }),
          );
          sftp.on('WRITE', (id, h, offset, data) =>
            reply(id, () => {
              fs.writeSync(handles.get(h.readUInt32BE())!.fd!, data, 0, data.length, offset);
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('CLOSE', (id, h) =>
            reply(id, () => {
              const key = h.readUInt32BE(),
                item = handles.get(key);
              if (item?.fd !== undefined) fs.closeSync(item.fd);
              handles.delete(key);
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('MKDIR', (id, p) =>
            reply(id, () => {
              fs.mkdirSync(path(p));
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('RMDIR', (id, p) =>
            reply(id, () => {
              fs.rmdirSync(path(p));
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('REMOVE', (id, p) =>
            reply(id, () => {
              fs.unlinkSync(path(p));
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('RENAME', (id, old, dest) =>
            reply(id, () => {
              fs.renameSync(path(old), path(dest));
              sftp.status(id, STATUS_CODE.OK);
            }),
          );
          sftp.on('close', () => {
            for (const item of handles.values()) if (item.fd !== undefined) fs.closeSync(item.fd);
          });
        });
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const device: Device = {
    id: randomUUID(),
    name: 'Fixture',
    type: 'linux-vps',
    icon: 'cloud',
    tags: [],
    notes: '',
    os: '',
    position: { x: 0, y: 0 },
    connection: {
      host: '127.0.0.1',
      port: (server.address() as { port: number }).port,
      username: 'test',
      auth: 'password',
      keyPath: '',
    },
    probe: { enabled: false, deviceId: '' },
    capabilities: { ssh: true, sftp: true, restart: false, shutdown: false },
  };
  const clients: Client[] = [];
  const connect = async () => {
    const client = await connectSSH(
      device,
      { password: 'fixture-pass' },
      async (address, fingerprint) => {
        assert.match(address, /^\[127.0.0.1\]:\d+$/);
        assert.match(fingerprint, /^SHA256:/);
        return true;
      },
    );
    clients.push(client);
    return client;
  };
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Fixture timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const terminalOutput: Buffer[] = [];
  const sessions = new Sessions(
    (output) => {
      terminalOutput.push(Buffer.from(output.data, 'base64'));
      sessions.acknowledge(output.id, output.bytes);
    },
    () => {},
  );
  let cancelOnce = false;
  let conflictHandler:
    ((conflict: TransferConflict, signal: AbortSignal) => Promise<ConflictDecision>) | undefined;
  const transfers = new Transfers(
    connect,
    (task) => {
      if (cancelOnce && task.name === 'cancel.bin' && task.transferred > 0) {
        cancelOnce = false;
        transfers.cancel(task.id);
      }
    },
    () => '',
    async (conflict, signal) => {
      if (!conflictHandler) throw new Error('目标已存在，不覆盖');
      return conflictHandler(conflict, signal);
    },
  );
  try {
    await assert.rejects(
      connectSSH(device, { password: 'fixture-pass' }, async () => false),
      /verification failed/,
    );
    await assert.rejects(
      connectSSH(device, { password: 'wrong' }, async () => true),
      /authentication/,
    );
    assert.equal(await executeSSH(await connect(), 'success'), 'fixture output');
    await assert.rejects(executeSSH(await connect(), 'failure'), /permission denied/);
    await writeFile(join(root, 'hello.txt'), '你好 Nexus');
    await writeFile(join(downloads, 'upload.txt'), 'upload payload');
    await withSFTP(await connect(), async (sftp) => {
      const listing = await listSFTP(sftp, '.');
      assert.equal(listing.path, '/');
      assert.equal(listing.entries[0].name, 'hello.txt');
      await new Promise<void>((r, j) =>
        sftp.fastGet('/hello.txt', join(downloads, 'hello.txt'), (e) => (e ? j(e) : r())),
      );
      assert.equal(await readFile(join(downloads, 'hello.txt'), 'utf8'), '你好 Nexus');
      await new Promise<void>((r, j) =>
        sftp.fastPut(join(downloads, 'upload.txt'), '/upload.txt', (e) => (e ? j(e) : r())),
      );
      assert.equal(await readFile(join(root, 'upload.txt'), 'utf8'), 'upload payload');
      await new Promise<void>((r, j) => sftp.mkdir('/new-dir', (e) => (e ? j(e) : r())));
      await new Promise<void>((r, j) =>
        sftp.rename('/upload.txt', '/renamed.txt', (e) => (e ? j(e) : r())),
      );
      assert.equal(
        (await listSFTP(sftp, '/')).entries.find((e) => e.name === 'new-dir')?.directory,
        true,
      );
      await new Promise<void>((r, j) => sftp.unlink('/renamed.txt', (e) => (e ? j(e) : r())));
      await new Promise<void>((r, j) => sftp.rmdir('/new-dir', (e) => (e ? j(e) : r())));
      await assert.rejects(listSFTP(sftp, '/missing'));
    });
    await assert.rejects(withSFTP(await connect(), (sftp) => previewSFTP(sftp, '/missing.txt')));
    const preview = await withSFTP(await connect(), (sftp) => previewSFTP(sftp, '/hello.txt'));
    assert.equal(preview.kind, 'text');
    if (preview.kind === 'text') assert.equal(preview.text, '你好 Nexus');
    await writeFile(join(root, 'large.log'), Buffer.alloc(TEXT_PREVIEW_BYTES + 1000, 'a'));
    const bounded = await withSFTP(await connect(), (sftp) => previewSFTP(sftp, '/large.log'));
    assert.equal(bounded.truncated, true);
    if (bounded.kind === 'text') assert.equal(bounded.text.length, TEXT_PREVIEW_BYTES);
    await assert.rejects(
      withSFTP(await connect(), async () => new Promise<void>(() => {}), 20),
      /超时/,
    );
    const shell = await sessions.open(await connect(), {
      deviceId: device.id,
      title: 'Fixture',
      kind: 'shell',
    });
    const snapshot = sessions.attach(shell.id);
    terminalOutput.push(Buffer.from(snapshot.data, 'base64'));
    sessions.write(shell.id, 'input\r');
    sessions.resize(shell.id, 120, 35);
    await waitFor(() => shellInput.includes('input') && resized);
    await waitFor(() => Buffer.concat(terminalOutput).toString('utf8').includes('echo:input'));
    assert.match(Buffer.concat(terminalOutput).toString('utf8'), /你好 shell/);
    sessions.detach(shell.id);
    sessions.close(shell.id);
    assert.equal(sessions.list().length, 0);

    const deployments = new Deployments(
      connect,
      () => 'fixture-identity',
      sessions,
      async () => '#!/bin/sh\necho safe fixture\n',
    );
    const plan = await deployments.prepare(device.id, 'docker');
    assert.match(plan.sha256, /^[a-f0-9]{64}$/);
    const reviewed = plan.script;
    plan.script = '#!/bin/sh\necho renderer cannot change the reviewed script\n';
    const deployment = await deployments.start(plan.id);
    await waitFor(
      () => sessions.list().find((item) => item.id === deployment.id)?.state === 'complete',
    );
    assert.equal(installedScripts[0], reviewed);
    await assert.rejects(deployments.start(plan.id), /过期/);
    installExit = 1;
    const failedPlan = await deployments.prepare(device.id, 'docker');
    const failed = await deployments.start(failedPlan.id);
    await waitFor(() => sessions.list().find((item) => item.id === failed.id)?.state === 'failed');
    installed = true;
    const blocked = await deployments.prepare(device.id, 'docker');
    await assert.rejects(deployments.start(blocked.id), /已安装/);
    installed = false;
    const changed = await deployments.prepare(device.id, 'docker');
    changedEnvironment = true;
    await assert.rejects(deployments.start(changed.id), /环境已变化/);
    changedEnvironment = false;
    installExit = 0;
    const panelPlan = await deployments.prepare(device.id, '3x-ui');
    const panel = await deployments.start(panelPlan.id);
    await waitFor(() => sessions.list().find((item) => item.id === panel.id)?.state === 'complete');

    fs.mkdirSync(join(downloads, 'tree', 'nested'), { recursive: true });
    fs.mkdirSync(join(downloads, 'tree', 'empty'));
    await writeFile(join(downloads, 'tree', 'nested', '你好.txt'), 'nested content');
    await writeFile(join(downloads, 'tree', 'zero.txt'), '');
    const uploaded = transfers.enqueue(device.id, 'upload', join(downloads, 'tree'), '/');
    await waitFor(
      () => transfers.list().find((item) => item.id === uploaded.id)?.state === 'complete',
    );
    assert.equal(
      await readFile(join(root, 'tree', 'nested', '你好.txt'), 'utf8'),
      'nested content',
    );
    fs.mkdirSync(join(downloads, 'received'));
    const downloaded = transfers.enqueue(
      device.id,
      'download',
      '/tree',
      join(downloads, 'received'),
    );
    await waitFor(
      () => transfers.list().find((item) => item.id === downloaded.id)?.state === 'complete',
    );
    assert.equal(
      await readFile(join(downloads, 'received', 'tree', 'nested', '你好.txt'), 'utf8'),
      'nested content',
    );
    assert.ok(fs.statSync(join(downloads, 'received', 'tree', 'empty')).isDirectory());
    const conflict = transfers.enqueue(device.id, 'download', '/tree', join(downloads, 'received'));
    await waitFor(
      () => transfers.list().find((item) => item.id === conflict.id)?.state === 'failed',
    );
    assert.match(transfers.list().find((item) => item.id === conflict.id)!.error!, /不覆盖/);
    const queued = transfers.enqueue(
      device.id,
      'download',
      '/hello.txt',
      join(downloads, 'received'),
    );
    transfers.cancel(queued.id);
    assert.equal(transfers.list().find((item) => item.id === queued.id)?.state, 'cancelled');
    transfers.retry(queued.id);
    await waitFor(
      () => transfers.list().find((item) => item.id === queued.id)?.state === 'complete',
    );
    await writeFile(join(downloads, 'cancel.bin'), Buffer.alloc(1024 * 1024, 'a'));
    cancelOnce = true;
    const cancelled = transfers.enqueue(device.id, 'upload', join(downloads, 'cancel.bin'), '/');
    await waitFor(
      () =>
        transfers.list().find((item) => item.id === cancelled.id)?.state === 'cancelled' &&
        !!transfers.list().find((item) => item.id === cancelled.id)?.error,
    );
    await waitFor(() => !fs.readdirSync(root).some((name) => name.includes('nexus-part')));
    transfers.retry(cancelled.id);
    await waitFor(
      () => transfers.list().find((item) => item.id === cancelled.id)?.state === 'complete',
    );
    assert.equal(fs.statSync(join(root, 'cancel.bin')).size, 1024 * 1024);
    await writeFile(join(root, '.hidden'), 'hidden file');
    const hidden = transfers.enqueue(
      device.id,
      'download',
      '/.hidden',
      join(downloads, 'received'),
    );
    await waitFor(
      () => transfers.list().find((item) => item.id === hidden.id)?.state === 'complete',
    );
    assert.equal(await readFile(join(downloads, 'received', '.hidden'), 'utf8'), 'hidden file');
    const finishTransfer = async (task: { id: string }) => {
      await waitFor(() =>
        ['complete', 'failed'].includes(
          transfers.list().find((item) => item.id === task.id)!.state,
        ),
      );
      const result = transfers.list().find((item) => item.id === task.id)!;
      assert.equal(result.state, 'complete', result.error);
      return result;
    };
    for (const direction of ['upload', 'download'] as const) {
      const source = direction === 'upload' ? join(downloads, 'same.txt') : '/same.txt';
      const destination = direction === 'upload' ? '/' : join(downloads, 'received');
      const original =
        direction === 'upload' ? join(root, 'same.txt') : join(downloads, 'received', 'same.txt');
      await writeFile(direction === 'upload' ? source : join(root, 'same.txt'), 'new payload');
      await writeFile(original, 'old');
      conflictHandler = async () => ({ choice: 'skip' });
      const skipped = await finishTransfer(
        transfers.enqueue(device.id, direction, source, destination),
      );
      assert.equal(skipped.skipped, 1);
      assert.equal(skipped.transferred, 0);
      assert.equal(await readFile(original, 'utf8'), 'old');
      conflictHandler = async () => ({ choice: 'keep-both' });
      await finishTransfer(transfers.enqueue(device.id, direction, source, destination));
      assert.equal(
        await readFile(join(direction === 'upload' ? root : destination, 'same (1).txt'), 'utf8'),
        'new payload',
      );
      assert.equal(await readFile(original, 'utf8'), 'old');
      conflictHandler = async () => ({ choice: 'replace' });
      await finishTransfer(transfers.enqueue(device.id, direction, source, destination));
      assert.equal(await readFile(original, 'utf8'), 'new payload');
    }
    await writeFile(join(root, 'tree', 'remote-only.txt'), 'keep remote');
    await writeFile(join(root, 'tree', 'nested', '你好.txt'), 'previous');
    let prompts = 0;
    conflictHandler = async (conflict) => {
      prompts++;
      return { choice: conflict.directory ? 'replace' : 'skip', applyToAll: true };
    };
    const merged = await finishTransfer(
      transfers.enqueue(device.id, 'upload', join(downloads, 'tree'), '/'),
    );
    assert.equal(await readFile(join(root, 'tree', 'remote-only.txt'), 'utf8'), 'keep remote');
    assert.equal(await readFile(join(root, 'tree', 'nested', '你好.txt'), 'utf8'), 'previous');
    assert.equal(merged.skipped, 2);
    assert.equal(prompts, 2);
    conflictHandler = async (conflict) => ({
      choice: conflict.directory && conflict.path.endsWith('/nested') ? 'keep-both' : 'replace',
    });
    await finishTransfer(transfers.enqueue(device.id, 'upload', join(downloads, 'tree'), '/'));
    assert.equal(
      await readFile(join(root, 'tree', 'nested (1)', '你好.txt'), 'utf8'),
      'nested content',
    );
    assert.equal(await readFile(join(root, 'tree', 'nested', '你好.txt'), 'utf8'), 'previous');
    await writeFile(join(root, 'same.txt'), 'safe before cancellation');
    conflictHandler = async (_conflict, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled conflict')), {
          once: true,
        }),
      );
    const waiting = transfers.enqueue(device.id, 'upload', join(downloads, 'same.txt'), '/');
    await waitFor(
      () => transfers.list().find((item) => item.id === waiting.id)?.state === 'waiting',
    );
    transfers.cancel(waiting.id);
    await waitFor(() => !!transfers.list().find((item) => item.id === waiting.id)?.error);
    assert.equal(await readFile(join(root, 'same.txt'), 'utf8'), 'safe before cancellation');
    conflictHandler = async () => {
      await writeFile(join(root, 'same.txt'), 'changed after confirmation');
      return { choice: 'replace' };
    };
    const changedTarget = transfers.enqueue(device.id, 'upload', join(downloads, 'same.txt'), '/');
    await waitFor(
      () => transfers.list().find((item) => item.id === changedTarget.id)?.state === 'failed',
    );
    assert.match(
      transfers.list().find((item) => item.id === changedTarget.id)!.error!,
      /确认后发生变化/,
    );
    assert.equal(await readFile(join(root, 'same.txt'), 'utf8'), 'changed after confirmation');
    assert.ok(!fs.readdirSync(root).some((name) => /nexus-part|nexus-backup/.test(name)));
    transfers.clear(device.id);
    assert.equal(transfers.list().length, 0);
  } finally {
    sessions.dispose();
    transfers.dispose();
    clients.forEach((c) => c.destroy());
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
    await rm(downloads, { recursive: true, force: true });
  }
});
