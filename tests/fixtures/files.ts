import { Server, utils } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkedEnvironment } from './operations';
import { PREFLIGHT_COMMAND } from '../../electron/deployment';

export const previewPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

export async function startFileServer(options: { operations?: boolean } = {}) {
  const directories = new Set(['/']);
  const commands: string[] = [];
  const shellInput: string[] = [];
  let pausedReads = false;
  const deferredReads: (() => void)[] = [];
  let nextTemporary = 1;
  let failInstall = false;
  let installedTool = '';
  const content = new Map<string, Buffer>([
    ['/hello.md', Buffer.from('# 你好 Nexus\n<script>globalThis.previewUnsafe = true</script>')],
    ['/image.png', previewPNG],
    ['/logo.png', readFileSync('assets/icon.png')],
    ['/binary.bin', Buffer.from([0, 1, 2, 3])],
    ['/large.log', Buffer.alloc(300 * 1024, 'a')],
  ]);
  const attributes = (path: string) => ({
    mode: directories.has(path) ? 0o40755 : 0o100644,
    uid: 0,
    gid: 0,
    size: content.get(path)?.length || 0,
    atime: 1,
    mtime: 1,
  });
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey;
  const clients = new Set<import('ssh2').Connection>();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', (context) => {
      if (
        context.method === 'password' &&
        context.username === 'user' &&
        context.password === 'preview-fixture-pass'
      )
        context.accept();
      else context.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept());
        session.on('window-change', (accept) => accept?.());
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write('fixture shell\r\n$ \x1b[?2004h');
          stream.on('data', (data: Buffer) => {
            shellInput.push(data.toString());
            stream.write(
              data
                .toString()
                .replace(/\x1b\[(?:200|201)~/g, '')
                .replaceAll('\r', '\r\n'),
            );
          });
        });
        session.on('exec', (accept, _reject, info) => {
          commands.push(info.command);
          const stream = accept();
          if (!options.operations) {
            stream.stderr.write('fixture command unavailable');
            stream.exit(1);
            stream.end();
            return;
          }
          if (info.command === PREFLIGHT_COMMAND) {
            stream.write(checkedEnvironment(installedTool ? { [installedTool]: '1' } : {}));
          } else if (info.command.includes('mktemp -d /tmp/nexus-deploy')) {
            const directory = `/tmp/nexus-deploy.UI${nextTemporary++}`;
            directories.add(directory);
            stream.write(directory + '\n');
          } else if (info.command.includes('Checking installation')) {
            stream.write('Group password (hidden): ');
            let input = '';
            stream.on('data', (data: Buffer) => {
              input += data.toString();
              if (/[\r\n]/.test(input)) {
                stream.write('\r\n[Nexus] Checking installation...\r\nfixture service active\r\n');
                stream.exit(failInstall ? 1 : 0);
                stream.end();
              }
            });
            return;
          } else {
            stream.stderr.write('fixture command unavailable');
            stream.exit(1);
            stream.end();
            return;
          }
          stream.exit(0);
          stream.end();
        });
        session.on('sftp', (accept) => {
          const sftp = accept();
          let listed = false;
          sftp.on('REALPATH', (request, path) => {
            const target = path === '.' ? '/' : path;
            sftp.name(request, [{ filename: target, longname: '', attrs: attributes(target) }]);
          });
          sftp.on('OPENDIR', (request, path) => {
            listed = false;
            sftp.handle(request, Buffer.from(path));
          });
          sftp.on('READDIR', (request, handle) => {
            if (listed) {
              sftp.status(request, utils.sftp.STATUS_CODE.EOF);
              return;
            }
            listed = true;
            sftp.name(
              request,
              [...directories, ...content.keys()]
                .filter((path) => {
                  const parent = handle.toString() === '/' ? '/' : handle.toString() + '/';
                  return (
                    path.startsWith(parent) &&
                    path !== parent &&
                    !path.slice(parent.length).includes('/')
                  );
                })
                .map((path) => ({
                  filename: path.split('/').pop()!,
                  longname: '',
                  attrs: attributes(path),
                })),
            );
          });
          sftp.on('OPEN', (request, path, flags) => {
            const mode = utils.sftp.flagsToString(flags) || '';
            if (options.operations && mode.startsWith('w')) {
              if (mode.includes('x') && content.has(path)) {
                sftp.status(request, utils.sftp.STATUS_CODE.FAILURE);
                return;
              }
              content.set(path, Buffer.alloc(0));
              sftp.handle(request, Buffer.from(path));
              return;
            }
            if (!content.has(path) || mode !== 'r') {
              sftp.status(request, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
              return;
            }
            sftp.handle(request, Buffer.from(path));
          });
          for (const operation of ['STAT', 'LSTAT'])
            sftp.on(operation, (request: number, path: string) => {
              if (!directories.has(path) && !content.has(path))
                sftp.status(request, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
              else sftp.attrs(request, attributes(path));
            });
          sftp.on('WRITE', (request, handle, offset, data) => {
            const path = handle.toString();
            const previous = content.get(path) || Buffer.alloc(0);
            const buffer = Buffer.alloc(Math.max(previous.length, offset + data.length));
            previous.copy(buffer);
            data.copy(buffer, offset);
            content.set(path, buffer);
            sftp.status(request, utils.sftp.STATUS_CODE.OK);
          });
          sftp.on('MKDIR', (request, path) => {
            directories.add(path);
            sftp.status(request, utils.sftp.STATUS_CODE.OK);
          });
          sftp.on('REMOVE', (request, path) => {
            content.delete(path);
            sftp.status(request, utils.sftp.STATUS_CODE.OK);
          });
          sftp.on('RMDIR', (request, path) => {
            directories.delete(path);
            sftp.status(request, utils.sftp.STATUS_CODE.OK);
          });
          sftp.on('RENAME', (request, source, destination) => {
            const data = content.get(source);
            if (!data || content.has(destination)) {
              sftp.status(request, utils.sftp.STATUS_CODE.FAILURE);
              return;
            }
            content.set(destination, data);
            content.delete(source);
            sftp.status(request, utils.sftp.STATUS_CODE.OK);
          });
          sftp.on('FSTAT', (request, handle) => sftp.attrs(request, attributes(handle.toString())));
          sftp.on('READ', (request, handle, offset, length) => {
            const reply = () => {
              const bytes = content.get(handle.toString())?.subarray(offset, offset + length);
              if (bytes?.length) sftp.data(request, bytes);
              else sftp.status(request, utils.sftp.STATUS_CODE.EOF);
            };
            if (pausedReads) deferredReads.push(reply);
            else reply();
          });
          sftp.on('CLOSE', (request) => sftp.status(request, utils.sftp.STATUS_CODE.OK));
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    commands,
    shellInput,
    pauseTransfers: () => {
      pausedReads = true;
    },
    resumeTransfers: () => {
      pausedReads = false;
      deferredReads.splice(0).forEach((reply) => reply());
    },
    pendingReads: () => deferredReads.length,
    failInstallation: () => {
      failInstall = true;
    },
    setInstalled: (tool: string) => {
      installedTool = tool;
    },
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
