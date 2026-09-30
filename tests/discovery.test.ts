import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  analyzeDiscovery,
  discoverServer,
  discoveryCommands,
  discoveryShellCommand,
  DiscoveryCache,
} from '../electron/discovery';
import { connectSSH, executeSSH } from '../electron/ssh';
import { discoveryFixture, startDiscoveryServer } from './fixtures/discovery';
import type { Device } from '../shared/types';

test('discovery correlates process ports and directories, preserves evidence and partial coverage', () => {
  const report = analyzeDiscovery(discoveryFixture);
  assert.equal(report.containers[0].project, 'notes');
  assert.equal(report.projects.find((p) => p.name === 'notes')?.confidence, 'confirmed');
  const node = report.projects.filter((p) => p.name === 'nexus-web');
  assert.equal(node.length, 1);
  assert.equal(node[0].confidence, 'candidate');
  assert.match(node[0].ports!, /3000/);
  assert.match(node[0].evidence, /101, 102/);
  assert.equal(report.projects.find((p) => p.name === 'weather-bot')?.kind, 'Python 项目');
  assert.equal(
    report.projects.some((p) => p.name === 'sshd'),
    false,
  );
  assert.equal(report.sources.find((s) => s.source === 'timers')?.status, 'unavailable');
  assert.match(report.sources.find((s) => s.source === 'timers')?.message || '', /权限/);
  assert.deepEqual(report.ports[1].pids, []);
  assert.equal(report.cron.length, 1);
});

test('malformed and bounded inventories are not presented as a complete empty server', () => {
  const report = analyzeDiscovery([
    { source: 'containers', output: 'not-json\nnull\n' },
    { source: 'processes', output: 'unexpected ps format\n__NEXUS_LIMIT__\n' },
    { source: 'ports', output: 'unrecognized format' },
    { source: 'services', error: 'systemctl: command not found' },
  ]);
  assert.equal(report.projects.length, 0);
  assert.equal(report.sources.filter((s) => s.status === 'limited').length, 3);
  assert.equal(report.sources.filter((s) => s.status === 'unavailable').length, 3);
});

test('discovery cache shares requests, expires, refreshes and isolates changed connections', async () => {
  const cache = new DiscoveryCache();
  let scans = 0;
  const scan = async () => {
    scans++;
    return analyzeDiscovery(discoveryFixture);
  };
  await Promise.all([cache.get('a', 'first', false, scan), cache.get('a', 'first', false, scan)]);
  assert.equal(scans, 1);
  await cache.get('a', 'first', false, scan);
  assert.equal(scans, 1);
  await cache.get('a', 'first', true, scan);
  assert.equal(scans, 2);
  await cache.get('a', 'second', false, scan);
  assert.equal(scans, 3);
  cache.invalidate('a');
  await cache.get('a', 'second', false, scan);
  assert.equal(scans, 4);
  await cache.get('old', 'first', false, async () => analyzeDiscovery(discoveryFixture, 1));
  await cache.get('old', 'first', false, scan);
  assert.equal(scans, 5);
  await assert.rejects(
    cache.get('a', 'third', false, async () => {
      throw new Error('offline');
    }),
  );
  await cache.get('a', 'third', false, scan);
  assert.equal(scans, 6);
});

test('discovery uses real SSH channels and recovers from per-command timeout and output limits', async () => {
  const fixture = await startDiscoveryServer();
  const device = {
    id: randomUUID(),
    connection: { host: '127.0.0.1', port: fixture.port, username: 'test', auth: 'password' },
  } as Device;
  const connect = () => connectSSH(device, { password: 'fixture-pass' }, async () => true);
  try {
    const report = await discoverServer(await connect());
    assert.equal(report.processes.length, 4);
    assert.equal(report.services.length, 2);
    assert.equal(fixture.control.requests.length, 7);
    const client = await connect();
    try {
      const listeners = client.listenerCount('close');
      await assert.rejects(executeSSH(client, 'hang', { keepOpen: true, timeoutMs: 40 }), /超时/);
      await assert.rejects(executeSSH(client, 'large', { keepOpen: true, maxBytes: 100 }), /上限/);
      assert.equal(await executeSSH(client, 'uname -s', { keepOpen: true }), 'Linux\n');
      assert.equal(await executeSSH(client, 'unicode', { keepOpen: true }), '中文项目目录');
      assert.equal(client.listenerCount('close'), listeners);
    } finally {
      client.end();
    }
    fixture.control.fail = true;
    await assert.rejects(discoverServer(await connect()), /未能读取/);
  } finally {
    await fixture.close();
  }
});

let shell = process.platform === 'win32' ? '' : '/bin/sh';
try {
  if (!shell)
    shell = join(
      dirname(execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]),
      '..',
      'bin',
      'bash.exe',
    );
} catch {
  /* Shell collectors can also be tested on Linux CI. */
}
test(
  'POSIX collectors execute with safe cron fields, accurate failures and bounded output',
  { skip: !existsSync(shell) },
  () => {
    for (const command of Object.values(discoveryCommands)) {
      const result = spawnSync(shell, ['-n', '-c', discoveryShellCommand(command)], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const run = (preamble: string, command: string) =>
      spawnSync(shell, ['-s'], { input: `${preamble}\n${command}`, encoding: 'utf8' });
    const processes = run(
      `ps() { printf '101 1 2.3 4.5 node\\n'; }
readlink() { printf '/srv/example\\n'; }`,
      discoveryCommands.processes,
    );
    assert.equal(processes.status, 0, processes.stderr);
    assert.match(processes.stdout, /101\t1\t2.3\t4.5\tnode\t\/srv\/example/);
    const services = run(
      `systemctl() { echo 'Permission denied' >&2; return 1; }`,
      discoveryCommands.services,
    );
    assert.equal(services.status, 1);
    const bounded = run(
      `systemctl() { i=0; while [ "$i" -lt 205 ]; do echo 'nginx.service loaded active running web'; i=$((i+1)); done; }`,
      discoveryCommands.services,
    );
    assert.match(bounded.stdout, /__NEXUS_LIMIT__/);
    assert.equal(bounded.stdout.trim().split('\n').length, 201);
    const cron = run(
      `crontab() { printf 'TOKEN=secret-value\\n0 3 * * * /opt/backup --password hidden-value\\n@reboot TOKEN=hidden-env /bin/app\\n'; }`,
      discoveryCommands.cron,
    );
    assert.equal(cron.status, 0, cron.stderr);
    assert.match(cron.stdout, /0 3 \* \* \* \| current user \| \/opt\/backup/);
    assert.doesNotMatch(cron.stdout, /secret-value|hidden-value|hidden-env/);
  },
);
