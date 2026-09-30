import { randomUUID } from 'node:crypto';
import { createWriteStream, constants } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, link, unlink, open } from 'node:fs/promises';
import { basename, join, posix, resolve, relative, isAbsolute, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { TransferTask } from '../shared/types';
import { withSFTP } from './ssh';

interface Item {
  path: string;
  directory: boolean;
  size: number;
}
interface Job {
  task: TransferTask;
  source: string;
  destination: string;
  identity: string;
  controller?: AbortController;
}
const MAX_ITEMS = 10_000;
const MAX_BYTES = 100 * 1024 ** 3;
export function transferName(name: string, windows = false) {
  if (!name || ['.', '..'].includes(name) || /[\\/\x00-\x1f\x7f]/.test(name))
    throw new Error('文件名包含非法路径字符');
  if (
    windows &&
    (/[<>:"|?*]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
  )
    throw new Error(`Windows 不支持文件名：${name}`);
  return name;
}
const remoteStat = (sftp: SFTPWrapper, path: string) =>
  new Promise<Stats>((resolve, reject) =>
    sftp.lstat(path, (error, info) => (error ? reject(error) : resolve(info))),
  );
async function remoteMissing(sftp: SFTPWrapper, path: string) {
  try {
    await remoteStat(sftp, path);
  } catch (error) {
    if ((error as { code?: number }).code === 2) return;
    throw error;
  }
  throw new Error(`目标已存在，不覆盖：${path}`);
}
async function localMissing(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`目标已存在，不覆盖：${path}`);
}
function within(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  if (!path || path === '..' || path.startsWith('..' + sep) || isAbsolute(path))
    throw new Error('本地临时路径超出目标目录');
}
export class Transfers {
  private jobs = new Map<string, Job>();
  private running = 0;
  constructor(
    private connect: (deviceId: string, signal?: AbortSignal) => Promise<Client>,
    private changed: (task: TransferTask) => void,
    private identity: (deviceId: string) => string = () => '',
  ) {}
  list() {
    return [...this.jobs.values()].map((job) => ({ ...job.task }));
  }
  enqueue(
    deviceId: string,
    direction: TransferTask['direction'],
    source: string,
    destination: string,
  ) {
    if (this.jobs.size >= 100) {
      for (const [id, job] of this.jobs)
        if (!['queued', 'running'].includes(job.task.state)) {
          this.jobs.delete(id);
          break;
        }
    }
    if (this.jobs.size >= 100) throw new Error('传输队列已满');
    const name = transferName(
      direction === 'upload' ? basename(source) : posix.basename(source),
      direction === 'download' && process.platform === 'win32',
    );
    const task: TransferTask = {
      id: randomUUID(),
      deviceId,
      direction,
      name,
      state: 'queued',
      transferred: 0,
      total: 0,
      files: 0,
    };
    this.jobs.set(task.id, { task, source, destination, identity: this.identity(deviceId) });
    this.changed({ ...task });
    queueMicrotask(() => this.pump());
    return { ...task };
  }
  cancel(id: string) {
    const job = this.get(id);
    if (!['queued', 'running'].includes(job.task.state)) return;
    job.controller?.abort();
    this.update(job, { state: 'cancelled' });
  }
  cancelDevice(deviceId: string) {
    for (const job of this.jobs.values())
      if (job.task.deviceId === deviceId) this.cancel(job.task.id);
  }
  retry(id: string) {
    const job = this.get(id);
    if (!['failed', 'cancelled'].includes(job.task.state))
      throw new Error('只允许重试失败或已取消的任务');
    if (job.controller) throw new Error('正在清理旧任务，请稍后重试');
    if (job.identity !== this.identity(job.task.deviceId))
      throw new Error('设备连接已变化，请重新创建传输任务');
    this.update(job, { state: 'queued', transferred: 0, total: 0, files: 0, error: undefined });
    this.pump();
  }
  private get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('传输任务不存在');
    return job;
  }
  private update(job: Job, change: Partial<TransferTask>) {
    Object.assign(job.task, change);
    this.changed({ ...job.task });
  }
  private pump() {
    for (const job of this.jobs.values()) {
      if (this.running >= 2) break;
      if (job.task.state !== 'queued' || job.controller) continue;
      if (
        [...this.jobs.values()].some(
          (other) => other !== job && other.task.deviceId === job.task.deviceId && other.controller,
        )
      )
        continue;
      this.running++;
      job.controller = new AbortController();
      this.update(job, { state: 'running' });
      void this.run(job)
        .then(
          () => {
            if (job.task.state !== 'cancelled')
              this.update(job, { state: 'complete', transferred: job.task.total });
          },
          (error) => {
            this.update(job, {
              state: job.controller!.signal.aborted ? 'cancelled' : 'failed',
              error: [String(error), job.task.error].filter(Boolean).join('；'),
            });
          },
        )
        .finally(() => {
          job.controller = undefined;
          this.running--;
          this.pump();
        });
    }
  }
  private async scan(job: Job, sftp: SFTPWrapper) {
    const items: Item[] = [];
    let bytes = 0;
    const walk = async (path: string, depth: number) => {
      job.controller!.signal.throwIfAborted();
      if (depth > 64 || items.length >= MAX_ITEMS)
        throw new Error('目录超出限制（64 层 / 10000 项）');
      const full =
        job.task.direction === 'upload' ? join(job.source, path) : posix.join(job.source, path);
      const info =
        job.task.direction === 'upload' ? await lstat(full) : await remoteStat(sftp, full);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error(`不传输符号链接或特殊文件：${full}`);
      if (info.isFile() && (!Number.isSafeInteger(info.size) || info.size < 0))
        throw new Error('源文件大小无效');
      items.push({ path, directory: info.isDirectory(), size: info.isFile() ? info.size : 0 });
      bytes += info.isFile() ? info.size : 0;
      if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) throw new Error('单项传输超过 100 GB');
      if (info.isDirectory()) {
        const names =
          job.task.direction === 'upload'
            ? await readdir(full)
            : await new Promise<string[]>((resolve, reject) =>
                sftp.readdir(full, (error, entries) =>
                  error ? reject(error) : resolve(entries.map((entry) => entry.filename)),
                ),
              );
        const seen = new Set<string>();
        for (const name of names.filter((name) => !['.', '..'].includes(name))) {
          transferName(name, job.task.direction === 'download' && process.platform === 'win32');
          const key =
            job.task.direction === 'download' && process.platform === 'win32'
              ? name.toLowerCase()
              : name;
          if (seen.has(key)) throw new Error(`目录包含重复或大小写冲突文件名：${name}`);
          seen.add(key);
          await walk(posix.join(path, name), depth + 1);
        }
      }
    };
    await walk('', 0);
    this.update(job, { total: bytes });
    return items;
  }
  private async run(job: Job) {
    const signal = job.controller!.signal;
    let client: Client | undefined;
    let temporary = '';
    const remoteFiles: string[] = [];
    const remoteDirectories: string[] = [];
    const abort = () => client?.destroy();
    const timer = setTimeout(
      () => job.controller?.abort(new Error('传输超过 30 分钟')),
      30 * 60_000,
    );
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (job.identity !== this.identity(job.task.deviceId))
        throw new Error('设备连接已变化，传输未执行');
      client = await this.connect(job.task.deviceId, signal);
      if (job.identity !== this.identity(job.task.deviceId))
        throw new Error('设备连接已变化，传输未执行');
      signal.throwIfAborted();
      await withSFTP(client, async (sftp) => {
        const items = await this.scan(job, sftp);
        const upload = job.task.direction === 'upload';
        const parent = upload
          ? await new Promise<string>((resolve, reject) =>
              sftp.realpath(job.destination, (error, path) =>
                error ? reject(error) : resolve(path),
              ),
            )
          : resolve(job.destination);
        const destination = upload
          ? posix.join(parent, job.task.name)
          : join(parent, job.task.name);
        temporary = upload
          ? posix.join(parent, `.${job.task.name}.${job.task.id}.nexus-part`)
          : join(parent, `.${job.task.name}.${job.task.id}.nexus-part`);
        if (!upload) within(parent, temporary);
        if (upload) {
          await remoteMissing(sftp, destination);
          await remoteMissing(sftp, temporary);
        } else {
          await localMissing(destination);
          await localMissing(temporary);
        }
        let lastUpdate = 0;
        for (const item of items) {
          signal.throwIfAborted();
          const target = upload ? posix.join(temporary, item.path) : join(temporary, item.path);
          const source = upload ? join(job.source, item.path) : posix.join(job.source, item.path);
          if (item.directory) {
            if (upload) {
              await new Promise<void>((resolve, reject) =>
                sftp.mkdir(target, { mode: 0o700 }, (error) => (error ? reject(error) : resolve())),
              );
              remoteDirectories.push(target);
            } else await mkdir(target, { mode: 0o700 });
            continue;
          }
          const current = upload ? await lstat(source) : await remoteStat(sftp, source);
          if (!current.isFile() || current.isSymbolicLink() || current.size !== item.size)
            throw new Error(`源文件已变化：${source}`);
          let received = 0;
          const meter = new Transform({
            transform: (chunk: Buffer, _encoding, callback) => {
              received += chunk.length;
              if (received > item.size) {
                callback(new Error('源文件在传输期间变大，已停止'));
                return;
              }
              job.task.transferred += chunk.length;
              if (Date.now() - lastUpdate >= 100) {
                lastUpdate = Date.now();
                this.changed({ ...job.task });
              }
              callback(null, chunk);
            },
          });
          if (upload) remoteFiles.push(target);
          await pipeline(
            upload
              ? (await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)).createReadStream()
              : sftp.createReadStream(source),
            meter,
            upload
              ? sftp.createWriteStream(target, { flags: 'wx', mode: 0o600 })
              : createWriteStream(target, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          if (received !== item.size) throw new Error('源文件在传输期间变小，已停止');
          job.task.files++;
        }
        signal.throwIfAborted();
        if (upload) {
          await remoteMissing(sftp, destination);
          await new Promise<void>((resolve, reject) =>
            sftp.rename(temporary, destination, (error) => (error ? reject(error) : resolve())),
          );
        } else {
          await localMissing(destination);
          if (items[0].directory) await rename(temporary, destination);
          else {
            await link(temporary, destination);
            await unlink(temporary);
          }
        }
        temporary = '';
        this.changed({ ...job.task });
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      client?.end();
      if (temporary) {
        if (job.task.direction === 'download') {
          within(job.destination, temporary);
          await rm(temporary, { recursive: true, force: true });
        } else {
          try {
            if (job.identity !== this.identity(job.task.deviceId))
              throw new Error('连接配置已变化，不清理其他服务器');
            await withSFTP(
              await this.connect(job.task.deviceId, AbortSignal.timeout(10_000)),
              async (sftp) => {
                for (const file of remoteFiles.reverse())
                  await new Promise<void>((done) => sftp.unlink(file, () => done()));
                for (const directory of remoteDirectories.reverse())
                  await new Promise<void>((done) => sftp.rmdir(directory, () => done()));
              },
              10_000,
            );
          } catch {
            job.task.error = `连接中断，临时文件可能保留在：${temporary}`;
          }
        }
      }
    }
  }
  dispose() {
    for (const job of this.jobs.values()) this.cancel(job.task.id);
  }
}
