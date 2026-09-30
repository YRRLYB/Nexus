import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { Credential, Device, FileListing } from '../shared/types';
export type VerifyHost = (address: string, fingerprint: string) => Promise<boolean>;
export async function connectSSH(
  device: Device,
  credential: Credential,
  verify: VerifyHost,
): Promise<Client> {
  if (!device.connection.host) throw new Error('请先编辑设备，填写 SSH 地址');
  const client = new Client();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('SSH 连接超时'));
    }, 60_000);
    client.once('ready', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    client.once('close', () => {
      clearTimeout(timer);
      reject(new Error('SSH 连接已关闭'));
    });
    const c = device.connection;
    try {
      client.connect({
        host: c.host,
        port: c.port,
        username: c.username,
        readyTimeout: 60_000,
        keepaliveInterval: 10_000,
        ...(c.auth === 'password'
          ? { password: credential.password }
          : c.auth === 'key'
            ? { privateKey: credential.privateKey, passphrase: credential.passphrase }
            : {
                agent:
                  process.platform === 'win32'
                    ? '\\\\.\\pipe\\openssh-ssh-agent'
                    : process.env.SSH_AUTH_SOCK,
              }),
        hostVerifier: (key: Buffer, callback: (accepted: boolean) => void) => {
          const fingerprint =
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
          void verify(`[${c.host}]:${c.port}`, fingerprint).then(callback, (error) => {
            clearTimeout(timer);
            reject(error);
            callback(false);
          });
        },
      });
    } catch (error) {
      clearTimeout(timer);
      client.destroy();
      reject(error);
    }
  });
}
export async function withSFTP<T>(
  client: Client,
  action: (sftp: SFTPWrapper) => Promise<T>,
  timeoutMs = 30 * 60_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<T>((resolve, reject) => {
        client.once('close', () => reject(new Error('SFTP 连接已中断')));
        client.once('error', reject);
        client.sftp((error, sftp) => (error ? reject(error) : action(sftp).then(resolve, reject)));
      }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SFTP 操作超时')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    client.end();
  }
}
export function listSFTP(sftp: SFTPWrapper, path: string): Promise<FileListing> {
  return new Promise((resolve, reject) =>
    sftp.realpath(path, (error, resolved) => {
      if (error) return reject(error);
      sftp.readdir(resolved, (error, files) =>
        error
          ? reject(error)
          : resolve({
              path: resolved,
              entries: files
                .filter(
                  (f) =>
                    f.filename !== '.' &&
                    f.filename !== '..' &&
                    !f.filename.includes('/') &&
                    !f.filename.includes('\0'),
                )
                .map((f) => ({
                  name: f.filename,
                  directory: f.attrs.isDirectory(),
                  symlink: f.attrs.isSymbolicLink(),
                  size: f.attrs.size,
                  mode: (f.attrs.mode & 0o7777).toString(8).padStart(4, '0'),
                  modified: f.attrs.mtime * 1000,
                }))
                .sort(
                  (a, b) =>
                    Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
                ),
            }),
      );
    }),
  );
}
export async function executeSSH(
  client: Client,
  command: string,
  options: { keepOpen?: boolean; timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: ClientChannel | undefined;
  let fail: (error: Error) => void = () => {};
  const closed = () => fail(new Error('连接提前断开，无法确认命令结果'));
  const errored = (error: Error) => fail(error);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
        channel?.close();
      };
      timer = setTimeout(() => fail(new Error('远程命令执行超时')), options.timeoutMs ?? 30_000);
      client.once('close', closed);
      client.once('error', errored);
      client.exec(command, (error, stream) => {
        if (error) return fail(error);
        channel = stream;
        if (settled) {
          stream.close();
          return;
        }
        let output = '';
        let received = 0;
        const stdout = new StringDecoder('utf8');
        const stderr = new StringDecoder('utf8');
        const append = (chunk: Buffer, decoder: StringDecoder) => {
          if (settled) return;
          received += chunk.length;
          if (options.maxBytes && received > options.maxBytes) {
            fail(new Error('输出超出本次识别上限'));
            return;
          }
          output = (output + decoder.write(chunk)).slice(-200_000);
        };
        stream.on('data', (chunk: Buffer) => append(chunk, stdout));
        stream.stderr.on('data', (chunk: Buffer) => append(chunk, stderr));
        stream.on('error', fail);
        stream.on('close', (code: number | undefined) => {
          if (settled) return;
          settled = true;
          output += stdout.end() + stderr.end();
          if (code !== 0)
            reject(new Error(output || `远程命令未成功完成（${code ?? '连接关闭'}）`));
          else resolve(output);
        });
      });
    });
  } finally {
    clearTimeout(timer);
    client.removeListener('close', closed);
    client.removeListener('error', errored);
    if (!options.keepOpen) client.end();
  }
}
