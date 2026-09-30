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
import type { Device } from '../shared/types';
const { STATUS_CODE } = utils.sftp;
test('real SSH/SFTP protocol: trust, auth, command errors, browse, transfer and file mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexus-sftp-'));
  const downloads = await mkdtemp(join(tmpdir(), 'nexus-transfer-'));
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey;
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
        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          if (info.command === 'success') {
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
  } finally {
    clients.forEach((c) => c.destroy());
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
    await rm(downloads, { recursive: true, force: true });
  }
});
