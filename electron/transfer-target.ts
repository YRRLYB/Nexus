import { lstat, mkdir, rename, link, unlink } from 'node:fs/promises';
import type { SFTPWrapper } from 'ssh2';

export interface TargetInfo {
  directory: boolean;
  size: number;
  modified: number;
  mode: number;
}
export class TransferTarget {
  constructor(private sftp?: SFTPWrapper) {}
  async info(path: string): Promise<TargetInfo | undefined> {
    try {
      const info = this.sftp
        ? await new Promise<import('ssh2').Stats>((resolve, reject) =>
            this.sftp!.lstat(path, (error, info) => (error ? reject(error) : resolve(info))),
          )
        : await lstat(path);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error(`目标是符号链接或特殊文件，拒绝覆盖：${path}`);
      return {
        directory: info.isDirectory(),
        size: info.size,
        modified: 'mtimeMs' in info ? info.mtimeMs : info.mtime * 1000,
        mode: info.mode,
      };
    } catch (error) {
      if (
        (error as { code?: string | number }).code === 2 ||
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return undefined;
      throw error;
    }
  }
  async missing(path: string) {
    if (await this.info(path)) throw new Error(`目标已存在：${path}`);
  }
  async assertUnchanged(path: string, expected?: TargetInfo) {
    const current = await this.info(path);
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error(`目标在确认后发生变化，请重试：${path}`);
  }
  async move(source: string, destination: string) {
    if (!this.sftp) return rename(source, destination);
    await new Promise<void>((resolve, reject) =>
      this.sftp!.rename(source, destination, (error) => (error ? reject(error) : resolve())),
    );
  }
  async makeDirectory(path: string) {
    if (!this.sftp) return mkdir(path, { mode: 0o700 });
    await new Promise<void>((resolve, reject) =>
      this.sftp!.mkdir(path, { mode: 0o700 }, (error) => (error ? reject(error) : resolve())),
    );
  }
  async removeFile(path: string) {
    if (!this.sftp) return unlink(path);
    await new Promise<void>((resolve, reject) =>
      this.sftp!.unlink(path, (error) => (error ? reject(error) : resolve())),
    );
  }
  async commitFile(
    source: string,
    destination: string,
    expected: TargetInfo | undefined,
    backup: string,
  ) {
    await this.assertUnchanged(destination, expected);
    if (!expected) {
      if (this.sftp) await this.move(source, destination);
      else {
        await link(source, destination);
        await unlink(source);
      }
      return;
    }
    if (expected.directory) throw new Error('不能用文件覆盖目录');
    if (!this.sftp) {
      await rename(source, destination);
      return;
    }
    await this.missing(backup);
    await this.move(destination, backup);
    try {
      await this.missing(destination);
      await this.move(source, destination);
    } catch (error) {
      try {
        await this.missing(destination);
        await this.move(backup, destination);
      } catch {
        throw new Error(`${String(error)}；原文件保留在 ${backup}，请检查服务器后恢复。`);
      }
      throw error;
    }
    try {
      await this.removeFile(backup);
    } catch {
      throw new Error(`新文件已写入；原文件备份未清理：${backup}`);
    }
  }
}
