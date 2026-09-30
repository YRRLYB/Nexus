import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let shell = process.platform === 'win32' ? '' : '/bin/sh';
try {
  if (!shell)
    shell = join(
      dirname(execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]),
      '..',
      'bin',
      'bash.exe',
    );
} catch {}
const scripts = [
  'scripts/install-docker.sh',
  'scripts/probe/install.sh',
  'scripts/probe/status.sh',
  'scripts/probe/uninstall.sh',
];
const noSideEffects = `curl() { echo 'Unexpected network access' >&2; exit 99; }
systemctl() { echo 'Unexpected service changes' >&2; exit 99; }
install() { echo 'Unexpected file changes' >&2; exit 99; }
mktemp() { echo 'Unexpected temporary file' >&2; exit 99; }`;

test(
  'public installer scripts have valid POSIX syntax and credentials are never defaults',
  { skip: !existsSync(shell) },
  () => {
    for (const path of scripts) {
      const source = readFileSync(path, 'utf8');
      const result = spawnSync(shell, ['-n', '-s'], { input: source, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(source, /defaults\.private\.env|server\.yrrlyb\.top|216\.23\.81/);
    }
    assert.match(readFileSync('scripts/probe/install.sh', 'utf8'), /^PASSWORD=''$/m);
  },
);

test(
  'probe dry-run chooses pinned checksummed releases across architectures without side effects',
  { skip: !existsSync(shell) },
  () => {
    const source = readFileSync('scripts/probe/install.sh', 'utf8');
    for (const [architecture, target] of [
      ['x86_64', 'x86_64-unknown-linux-musl'],
      ['aarch64', 'aarch64-unknown-linux-musl'],
      ['armv7l', 'armv7-unknown-linux-musleabihf'],
    ]) {
      const input = `${noSideEffects}\nuname() { case "$1" in -s) echo Linux ;; -m) echo ${architecture} ;; esac; }\nset -- --dry-run\n${source}`;
      const result = spawnSync(shell, ['-s'], { input, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(target));
      assert.match(result.stdout, /SHA-256: [a-f0-9]{64}/);
      assert.match(result.stdout, /No downloads or system changes/);
    }
    const unsupported = spawnSync(shell, ['-s'], {
      input: `uname() { echo unsupported; }\nset -- --dry-run\n${source}`,
      encoding: 'utf8',
    });
    assert.notEqual(unsupported.status, 0);
    const missingArgument = spawnSync(shell, ['-s'], {
      input: `set -- --server\n${source}`,
      encoding: 'utf8',
    });
    assert.equal(missingArgument.status, 2);
  },
);

test(
  'Docker already-installed path makes no changes and preserves the installed version',
  { skip: !existsSync(shell) },
  () => {
    const source = readFileSync('scripts/install-docker.sh', 'utf8')
      .replace('. /etc/os-release', 'ID=debian')
      .replace('[ -r /etc/os-release ]', 'true');
    const input = `${noSideEffects}\nuname() { echo Linux; }\ndocker() { echo 'Docker fixture-version'; }\nset --\n${source}`;
    const result = spawnSync(shell, ['-s'], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fixture-version/);
    assert.match(result.stdout, /No changes made/);
  },
);
