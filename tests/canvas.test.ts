import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt, framePositions } from '../shared/canvas';
import { resolveOS } from '../shared/os';
import { deviceSchema } from '../shared/validation';
test('cursor anchored zoom keeps the same world point under the pointer', () => {
  const camera = { x: -450, y: 320, zoom: 0.75 },
    point = { x: 500, y: 300 };
  const next = zoomAt(camera, 1.5, point);
  assert.equal((point.x - next.x) / next.zoom, (point.x - camera.x) / camera.zoom);
  assert.equal((point.y - next.y) / next.zoom, (point.y - camera.y) / camera.zoom);
});
test('negative and distant positions remain valid and can be framed', () => {
  assert.deepEqual(deviceSchema.shape.position.parse({ x: -20000, y: 36000 }), {
    x: -20000,
    y: 36000,
  });
  const positions = [
    { x: -8100, y: -9100 },
    { x: -7800, y: -9000 },
  ];
  const camera = framePositions(positions, 1400, 900);
  for (const p of positions) {
    const x = p.x * camera.zoom + camera.x,
      y = p.y * camera.zoom + camera.y;
    assert(x > 0 && x + 136 * camera.zoom < 1400);
    assert(y > 0 && y + 140 * camera.zoom < 900);
  }
});
test('system marks resolve from device type, release string or probe without pretending generic Linux is Ubuntu', () => {
  assert.equal(resolveOS({ type: 'windows', os: '' }).family, 'windows');
  assert.equal(resolveOS({ type: 'linux-vps', os: 'Ubuntu 24.04 LTS' }).family, 'ubuntu');
  assert.equal(resolveOS({ type: 'linux-vps', os: '' }, 'debian').family, 'debian');
  assert.equal(resolveOS({ type: 'linux-server', os: '' }).family, 'linux');
  assert.equal(resolveOS({ type: 'nas', os: '' }).family, 'unknown');
  assert.equal(resolveOS({ type: 'macos', os: '' }).family, 'apple');
});
