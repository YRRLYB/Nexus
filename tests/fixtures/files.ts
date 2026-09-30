import { Server, utils } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const previewPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

export async function startFileServer() {
  const content = new Map<string, Buffer>([
    ['/hello.md', Buffer.from('# 你好 Nexus\n<script>globalThis.previewUnsafe = true</script>')],
    ['/image.png', previewPNG],
    ['/logo.png', readFileSync('assets/icon.png')],
    ['/binary.bin', Buffer.from([0, 1, 2, 3])],
    ['/large.log', Buffer.alloc(300 * 1024, 'a')],
  ]);
  const attributes = (path: string) => ({
    mode: path === '/' ? 0o40755 : 0o100644,
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
        session.on('sftp', (accept) => {
          const sftp = accept();
          let listed = false;
          sftp.on('REALPATH', (request) =>
            sftp.name(request, [{ filename: '/', longname: '', attrs: attributes('/') }]),
          );
          sftp.on('OPENDIR', (request) => {
            listed = false;
            sftp.handle(request, Buffer.from('/'));
          });
          sftp.on('READDIR', (request) => {
            if (listed) {
              sftp.status(request, utils.sftp.STATUS_CODE.EOF);
              return;
            }
            listed = true;
            sftp.name(
              request,
              [...content.keys()].map((path) => ({
                filename: path.slice(1),
                longname: '',
                attrs: attributes(path),
              })),
            );
          });
          sftp.on('OPEN', (request, path, flags) => {
            if (!content.has(path) || utils.sftp.flagsToString(flags) !== 'r') {
              sftp.status(request, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
              return;
            }
            sftp.handle(request, Buffer.from(path));
          });
          sftp.on('FSTAT', (request, handle) => sftp.attrs(request, attributes(handle.toString())));
          sftp.on('READ', (request, handle, offset, length) => {
            const bytes = content.get(handle.toString())?.subarray(offset, offset + length);
            if (bytes?.length) sftp.data(request, bytes);
            else sftp.status(request, utils.sftp.STATUS_CODE.EOF);
          });
          sftp.on('CLOSE', (request) => sftp.status(request, utils.sftp.STATUS_CODE.OK));
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
