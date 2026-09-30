import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicePlatform, deviceProfile } from '../shared/device';
import { quickCommand, installCommand } from '../electron/device';
import { deviceSchema, sshArgs } from '../shared/validation';

test('device profiles protect Windows, macOS and unknown NAS from Linux-only operations', () => {
  assert.equal(devicePlatform({ type: 'linux-vps', os: 'Windows Server 2022' }), 'windows');
  assert.equal(deviceProfile({ type: 'windows', os: '' }).deployment, false);
  assert.equal(deviceProfile({ type: 'macos', os: '' }).discovery, false);
  assert.equal(deviceProfile({ type: 'nas', os: '' }).power, false);
  assert.equal(deviceProfile({ type: 'nas', os: 'Debian' }).discovery, true);
  assert.equal(deviceProfile({ type: 'linux-vps', os: 'Alpine Linux' }).power, true);
});

test('quick commands follow the remote OS and Linux service managers fall back safely', () => {
  for (const action of ['services', 'logs', 'sysinfo'] as const) {
    const command = quickCommand({ type: 'windows', os: '' }, action);
    assert.match(command, /^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
    const decoded = Buffer.from(command.split(' ').at(-1)!, 'base64').toString('utf16le');
    assert.match(decoded, /Get-Service|Get-WinEvent|Get-CimInstance/);
    assert.doesNotMatch(decoded, /systemctl|journalctl|\/etc\/os-release/);
  }
  assert.equal(quickCommand({ type: 'macos', os: '' }, 'services'), 'launchctl list');
  assert.match(quickCommand({ type: 'linux-vps', os: 'Alpine' }, 'services'), /rc-status/);
  assert.match(quickCommand({ type: 'linux-vps', os: '' }, 'logs'), /logread/);
  assert.throws(() => quickCommand({ type: 'nas', os: '' }, 'services'), /实际系统/);
});

test('installation commands point to public scripts, preserve quoting and support root sessions', () => {
  for (const tool of ['docker', 'probe'] as const) {
    const command = installCommand(tool);
    assert.match(command, /raw.githubusercontent.com\/YRRLYB\/Nexus\/main\/scripts\//);
    assert.match(command, /curl --fail/);
    assert.match(command, /id -u/);
    assert.match(command, /sudo sh "\$installer"/);
    assert.doesNotMatch(command, /password|SSR_PASS|defaults.private/);
  }
});

test('SSH usernames support Windows domain and email accounts without shell option injection', () => {
  for (const username of ['root', 'DOMAIN\\tester', 'tester@example.com']) {
    assert.equal(deviceSchema.shape.connection.shape.username.parse(username), username);
    assert.deepEqual(
      sshArgs({
        connection: { host: 'example.com', port: 22, username, auth: 'agent', keyPath: '' },
      }),
      ['-p', '22', '-l', username, '--', 'example.com'],
    );
  }
  for (const username of ['-oProxyCommand=bad', 'root; whoami', 'root\nwhoami'])
    assert.throws(() => deviceSchema.shape.connection.shape.username.parse(username));
});
