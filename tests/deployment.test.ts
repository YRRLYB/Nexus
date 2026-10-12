import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Client } from 'ssh2';
import { checkedEnvironment } from './fixtures/operations';
import {
  deploymentCommand,
  fetchInstaller,
  installerSources,
  parsePreflight,
  probeInstallSchema,
  shellQuote,
  stageInstaller,
  XUI_VERSION,
} from '../electron/deployment';
import { transferName } from '../electron/transfers';

test('deployment checks the actual system, privileges, architecture and existing software', () => {
  assert.deepEqual(parsePreflight(checkedEnvironment(), 'docker').blockers, []);
  const cases: Record<string, string>[] = [
    { system: 'Darwin' },
    { distribution: 'alpine' },
    { architecture: 'mips' },
    { uid: '1000', sudo: '0' },
    { docker: '1' },
    { bash: '0' },
  ];
  for (const fields of cases)
    assert.ok(parsePreflight(checkedEnvironment(fields), 'docker').blockers.length);
  assert.ok(
    parsePreflight(checkedEnvironment({ distribution: 'ubuntu', version: '25.10' }), 'baota')
      .blockers.length,
  );
  assert.ok(parsePreflight(checkedEnvironment({ version: 'unknown' }), 'baota').blockers.length);
  assert.ok(
    parsePreflight(checkedEnvironment({ systemd: '0', unzip: '0' }), 'probe').blockers.length >= 2,
  );
  assert.ok(parsePreflight(checkedEnvironment({ otherProbe: '1' }), 'probe').blockers.length);
  assert.throws(() => parsePreflight('banner only', 'docker'));
  assert.throws(() => parsePreflight('__NEXUS_CHECK__\nsystem=Linux', 'probe'));
});

test('3x-ui pins its installer and release, rejects existing panels and requires systemd', async () => {
  const check = parsePreflight(checkedEnvironment(), '3x-ui');
  assert.deepEqual(check.blockers, []);
  const cases: Record<string, string>[] = [
    { '3x-ui': '1' },
    { systemd: '0' },
    { systemctl: '0' },
    { architecture: 'mips' },
    { distribution: 'alpine' },
  ];
  for (const fields of cases)
    assert.ok(parsePreflight(checkedEnvironment(fields), '3x-ui').blockers.length);
  const source = await fetchInstaller('3x-ui', (async (url, options) => {
    assert.equal(url, `https://raw.githubusercontent.com/MHSanaei/3x-ui/${XUI_VERSION}/install.sh`);
    assert.equal(options?.redirect, 'error');
    return new Response('#!/bin/bash\necho pinned panel\n');
  }) as typeof fetch);
  assert.match(source, /pinned panel/);
  const command = deploymentCommand('3x-ui', '/tmp/nexus-deploy.TEST123', check);
  assert.ok(command.includes(XUI_VERSION));
  assert.match(command, /test -x \/usr\/local\/x-ui\/x-ui/);
  assert.match(command, /systemctl is-active --quiet x-ui.service/);
  assert.match(command, /systemctl is-enabled --quiet x-ui.service/);
});

test('installer downloads use fixed HTTPS sources, size limits and reject redirects or active documents', async () => {
  const request = (async (url: string, options: RequestInit) => {
    assert.equal(url, installerSources.baota);
    assert.equal(options.redirect, 'error');
    return new Response('#!/bin/bash\necho fixture\n');
  }) as typeof fetch;
  assert.match(await fetchInstaller('baota', request), /fixture/);
  for (const response of [
    new Response('<html>error</html>'),
    new Response('error', { status: 503 }),
    new Response('#!/bin/sh\n' + 'a'.repeat(1024 * 1024)),
  ])
    await assert.rejects(fetchInstaller('docker', (async () => response) as typeof fetch));
});

test('probe form requires HTTPS report endpoint and keeps group passwords out of command parameters', () => {
  const input = {
    server: 'https://status.example.com/report',
    group: 'group',
    alias: "node's name; echo not-a-command",
    location: 'cn',
  };
  assert.deepEqual(probeInstallSchema.parse(input), input);
  for (const server of [
    'http://status.example.com/report',
    'https://user:secret@host/report',
    'https://host/stats.json',
    'https://host/report?password=secret',
  ])
    assert.throws(() => probeInstallSchema.parse({ ...input, server }));
  assert.throws(() => probeInstallSchema.parse({ ...input, password: 'secret' }));
  assert.throws(() => probeInstallSchema.parse({ ...input, group: 'line\nbreak' }));
  const command = deploymentCommand(
    'probe',
    '/tmp/nexus-deploy.TEST123',
    parsePreflight(checkedEnvironment({ uid: '1000' }), 'probe'),
    input,
  );
  assert.match(command, /sudo/);
  assert.match(command, /systemctl is-active/);
  assert.doesNotMatch(command, /--password|SSR_PASS|yes \|/);
  assert.throws(() =>
    deploymentCommand('docker', '/tmp/../../etc', parsePreflight(checkedEnvironment(), 'docker')),
  );
});

test('transfer filenames block traversal, Windows devices, alternate streams and ambiguous suffixes', () => {
  assert.equal(transferName('你好.png', true), '你好.png');
  for (const name of [
    '../secret',
    '..',
    'a/b',
    'a\\b',
    'line\nbreak',
    'nul.txt',
    'COM1',
    'COM¹',
    'CONOUT$',
    'file:stream',
    'trailing.',
  ])
    assert.throws(() => transferName(name, true));
});

test('stalled installer uploads time out and close their SFTP channel', async () => {
  const client = new EventEmitter() as EventEmitter & {
    sftp: (callback: (error: null, channel: unknown) => void) => void;
  };
  let ended = false;
  const channel = Object.assign(new EventEmitter(), {
    end: () => {
      ended = true;
    },
    writeFile: () => {},
  });
  client.sftp = (callback) => callback(null, channel);
  await assert.rejects(
    stageInstaller(client as unknown as Client, '/tmp/nexus-deploy.TEST', '#!/bin/sh', 20),
    /超时/,
  );
  assert.equal(ended, true);
  assert.equal(client.listenerCount('close'), 0);
  assert.equal(client.listenerCount('error'), 0);
});

let shell = '/bin/sh';
if (process.platform === 'win32') {
  try {
    shell = join(
      dirname(execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]),
      '..',
      'bin',
      'bash.exe',
    );
  } catch {
    shell = '';
  }
}
test(
  'deployment wrappers have valid shell syntax and user parameters stay literal',
  { skip: !existsSync(shell) },
  () => {
    for (const tool of ['docker', 'baota', 'probe', '3x-ui'] as const) {
      const command = deploymentCommand(
        tool,
        '/tmp/nexus-deploy.TEST123',
        parsePreflight(checkedEnvironment(), tool),
        {
          server: 'https://status.example.com/report',
          group: "'; touch /bad; '",
          alias: '节点',
          location: 'cn',
        },
      );
      const result = spawnSync(shell, ['-n', '-s'], { input: command, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const payload = "quote'; $(printf injected); & exit 99";
    const result = spawnSync(shell, ['-s'], {
      input: `set -- ${shellQuote(payload)}; printf '%s' "$1"`,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, payload);
  },
);
