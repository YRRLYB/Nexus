import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { normalizeProbe, advancePower, fetchProbe } from '../electron/probe';
import { Store } from '../electron/store';
import { deviceSchema, psQuote, settingsSchema, sshArgs } from '../shared/validation';
import type { Device } from '../shared/types';
import { createServer } from 'node:http';
export const fixtureDevice = (): Device => ({
  id: randomUUID(),
  name: 'Test Server',
  type: 'linux-vps',
  icon: 'cloud',
  tags: ['test'],
  notes: '',
  os: '',
  position: { x: 10, y: 20 },
  connection: { host: '127.0.0.1', port: 22, username: 'root', auth: 'password', keyPath: '' },
  probe: { enabled: true, deviceId: 'stable-id' },
  capabilities: { ssh: true, sftp: true, restart: true, shutdown: true },
});
const now = 1_800_000_000_000;
const payload = {
  updated: now / 1000,
  servers: [
    {
      name: 'stable-id',
      alias: 'Tokyo',
      cpu: 25,
      memory_total: 200,
      memory_used: 50,
      hdd_total: 100,
      hdd_used: 40,
      network_rx: 1000,
      network_tx: 500,
      latest_ts: now / 1000 - 5,
      online4: true,
      online6: false,
      labels: 'location=jp;os=ubuntu',
      uptime: '2 天',
    },
  ],
};
test('ServerStatus stable identity, units and metrics', () => {
  const [n] = normalizeProbe(payload, 90, now);
  assert.equal(n.id, 'stable-id');
  assert.equal(n.name, 'Tokyo');
  assert.equal(n.memory, 25);
  assert.equal(n.disk, 40);
  assert.equal(n.memoryTotal, 200 * 1024);
  assert.equal(n.diskTotal, 100 * 1024 ** 2);
  assert.equal(n.os, 'ubuntu');
  assert.equal(n.online, true);
});
test('stale metrics never produce online; malformed counters are not fabricated', () => {
  const [n] = normalizeProbe(payload, 90, now + 100_000);
  assert.equal(n.online, false);
  assert.equal(n.stale, true);
  const [empty] = normalizeProbe(
    {
      updated: now / 1000,
      servers: [{ name: 'x', online4: 'true', latest_ts: now / 1000, cpu: '15', memory_total: 0 }],
    },
    90,
    now,
  );
  assert.equal(empty.cpu, null);
  assert.equal(empty.memory, null);
  assert.equal(empty.online, false);
  assert.throws(() => normalizeProbe({}, 90));
});
test('reboot requires an observed offline then a fresh online report', () => {
  const node = normalizeProbe(payload, 90, now)[0];
  const state = {
    action: 'restart' as const,
    phase: 'waiting-offline' as const,
    startedAt: now - 10_000,
  };
  assert.equal(advancePower(state, node, now).phase, 'waiting-offline');
  const off = advancePower(state, { ...node, online: false }, now);
  assert.equal(off.phase, 'waiting-online');
  assert.equal(advancePower(off, node, now).phase, 'complete');
  assert.equal(advancePower(state, undefined, now + 300_000).phase, 'timeout');
  assert.equal(
    advancePower({ ...state, action: 'shutdown' }, { ...node, online: false }, now).phase,
    'complete',
  );
});
test('validates arguments and prevents SSH option injection', () => {
  const d = fixtureDevice();
  assert.equal(deviceSchema.parse(d).connection.port, 22);
  assert.throws(() =>
    deviceSchema.parse({ ...d, connection: { ...d.connection, host: '-oProxyCommand=evil' } }),
  );
  assert.throws(() =>
    deviceSchema.parse({ ...d, connection: { ...d.connection, username: 'root; whoami' } }),
  );
  assert.throws(() =>
    settingsSchema.parse({ probeUrl: 'file:///etc/passwd', pollSeconds: 10, staleSeconds: 90 }),
  );
  assert.deepEqual(sshArgs(d), ['-p', '22', '-l', 'root', '--', '127.0.0.1']);
  assert.equal(psQuote("C:\\a'b\\key"), "'C:\\a''b\\key'");
});
test('SQLite persistence, encrypted secret isolation, clearing and deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-store-'));
  const path = join(dir, 'db.sqlite');
  const key = randomBytes(32);
  const cipher = {
    encrypt: (value: string) => {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(value), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
    },
    decrypt: (value: string) => {
      const data = Buffer.from(value, 'base64'),
        d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      d.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString();
    },
  };
  let store = await Store.open(path, cipher);
  try {
    const d = fixtureDevice();
    store.saveDevice(d, { password: 'HIGHLY_SECRET_PASSWORD' });
    store.move(d.id, { x: 33, y: 99 });
    store.saveSettings(
      { probeUrl: 'https://example.org/stats', pollSeconds: 10, staleSeconds: 90 },
      'SECRET_TOKEN_123',
    );
    assert.equal((await readFile(path)).includes(Buffer.from('HIGHLY_SECRET_PASSWORD')), false);
    assert.equal((await readFile(path)).includes(Buffer.from('SECRET_TOKEN_123')), false);
    assert.equal(JSON.stringify(store.devices()).includes('HIGHLY_SECRET_PASSWORD'), false);
    store.close();
    store = await Store.open(path, cipher);
    assert.equal(store.device(d.id).position.x, 33);
    assert.equal(store.credential(d.id).password, 'HIGHLY_SECRET_PASSWORD');
    assert.equal(store.token(), 'SECRET_TOKEN_123');
    store.saveDevice(store.device(d.id), undefined, true);
    assert.equal(store.device(d.id).hasCredential, false);
    store.deleteDevice(d.id);
    assert.equal(store.devices().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('probe fetch errors distinguish stale source, HTTP failures and invalid JSON', async () => {
  let response = JSON.stringify({ ...payload, updated: Date.now() / 1000 });
  let code = 200;
  const server = createServer((_req, res) => {
    res.writeHead(code);
    res.end(response);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const settings = { probeUrl: `http://127.0.0.1:${port}`, pollSeconds: 10, staleSeconds: 90 };
  try {
    assert.equal((await fetchProbe(settings)).nodes.length, 1);
    response = '{broken';
    await assert.rejects(fetchProbe(settings));
    response = JSON.stringify({ updated: 1, servers: [] });
    await assert.rejects(fetchProbe(settings), /时间戳/);
    code = 401;
    await assert.rejects(fetchProbe(settings), /401/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
