import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SFTPWrapper, Stats } from 'ssh2';
import { TransferTarget } from '../electron/transfer-target';

test('local replacement preserves old content until commit and rejects stale or linked targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-target-'));
  try {
    const target = new TransferTarget();
    const destination = join(directory, 'file');
    const staged = join(directory, 'stage');
    await writeFile(destination, 'old');
    await writeFile(staged, 'replacement');
    const original = await target.info(destination);
    await writeFile(destination, 'changed by another program');
    await assert.rejects(target.commitFile(staged, destination, original, ''), /确认后发生变化/);
    assert.equal(await readFile(destination, 'utf8'), 'changed by another program');
    await target.commitFile(staged, destination, await target.info(destination), '');
    assert.equal(await readFile(destination, 'utf8'), 'replacement');
    await writeFile(staged, 'new');
    await assert.rejects(target.commitFile(staged, destination, undefined, ''), /确认后发生变化/);
    assert.equal(await readFile(destination, 'utf8'), 'replacement');
    const linked = join(directory, 'linked');
    await symlink(directory, linked, 'junction');
    await assert.rejects(target.info(linked), /符号链接/);
    await target.commitFile(staged, join(directory, 'new-file'), undefined, '');
    assert.equal(await readFile(join(directory, 'new-file'), 'utf8'), 'new');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SFTP replacement rolls back a failed commit and reports preserved backups when recovery fails', async () => {
  for (const failRestore of [false, true]) {
    const files = new Map([
      ['/file', 'original'],
      ['/stage', 'replacement'],
    ]);
    const target = new TransferTarget({
      lstat: (path: string, callback: (error: Error | null, info?: Stats) => void) => {
        const content = files.get(path);
        if (content === undefined)
          callback(Object.assign(new Error('missing'), { code: 2 }), undefined);
        else
          callback(null, {
            size: content.length,
            mode: 0o100600,
            mtime: 1,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          } as Stats);
      },
      rename: (source: string, destination: string, callback: (error: Error | null) => void) => {
        if (source === '/stage' || (failRestore && source === '/backup')) {
          callback(new Error('injected failure'));
          return;
        }
        assert.ok(!files.has(destination));
        files.set(destination, files.get(source)!);
        files.delete(source);
        callback(null);
      },
    } as unknown as SFTPWrapper);
    await assert.rejects(
      target.commitFile('/stage', '/file', await target.info('/file'), '/backup'),
      failRestore ? /原文件保留在 \/backup/ : /injected failure/,
    );
    assert.equal(files.get(failRestore ? '/backup' : '/file'), 'original');
    assert.equal(files.get('/stage'), 'replacement');
    assert.equal(files.has(failRestore ? '/file' : '/backup'), false);
  }
});

test('SFTP replacement completes before deleting its backup and reports cleanup failures', async () => {
  const files = new Map([
    ['/file', 'original'],
    ['/stage', 'replacement'],
  ]);
  const target = new TransferTarget({
    lstat: (path: string, callback: (error: Error | null, info?: Stats) => void) => {
      const content = files.get(path);
      if (content === undefined)
        callback(Object.assign(new Error('missing'), { code: 2 }), undefined);
      else
        callback(null, {
          size: content.length,
          mode: 0o100600,
          mtime: 1,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        } as Stats);
    },
    rename: (source: string, destination: string, callback: (error: Error | null) => void) => {
      assert.ok(!files.has(destination));
      files.set(destination, files.get(source)!);
      files.delete(source);
      callback(null);
    },
    unlink: (_path: string, callback: (error: Error) => void) =>
      callback(new Error('cleanup failed')),
  } as unknown as SFTPWrapper);
  await assert.rejects(
    target.commitFile('/stage', '/file', await target.info('/file'), '/backup'),
    /新文件已写入.*\/backup/,
  );
  assert.equal(files.get('/file'), 'replacement');
  assert.equal(files.get('/backup'), 'original');
});
