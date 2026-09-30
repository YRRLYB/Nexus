import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreview, previewLocal } from '../electron/preview';
import { TEXT_PREVIEW_BYTES, IMAGE_PREVIEW_BYTES, localFilePath } from '../shared/preview';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

test('preview detects image signatures, rejects spoofed images and never renders active documents', () => {
  const result = createPreview('/picture.png', png.length, png);
  assert.equal(result.kind, 'image');
  if (result.kind === 'image') assert.match(result.data, /^data:image\/png;base64,/);
  const svg = Buffer.from('<svg onload="alert(1)"></svg>');
  assert.equal(createPreview('/unsafe.svg', svg.length, svg).kind, 'text');
  const html = Buffer.from('<script>alert(1)</script>');
  assert.equal(createPreview('/index.html', html.length, html).kind, 'text');
  assert.throws(() => createPreview('/fake.png', html.length, html), /图片格式无效/);
  assert.throws(() => createPreview('/large.png', IMAGE_PREVIEW_BYTES + 1, png), /8 MB/);
});

test('text preview is bounded, handles UTF-8 boundary splits and rejects binary and invalid encoding', () => {
  const text = Buffer.from('hello 你好\n');
  assert.deepEqual(createPreview('/hello.txt', text.length, text), {
    kind: 'text',
    path: '/hello.txt',
    size: text.length,
    text: 'hello 你好\n',
    truncated: false,
  });
  const large = Buffer.concat([Buffer.alloc(TEXT_PREVIEW_BYTES - 1, 'a'), Buffer.from('你好')]);
  const result = createPreview('/large.log', large.length, large);
  assert.equal(result.truncated, true);
  assert.equal(result.kind, 'text');
  if (result.kind === 'text') assert.equal(result.text.length, TEXT_PREVIEW_BYTES - 1);
  assert.throws(() => createPreview('/binary', 4, Buffer.from([0, 1, 2, 3])), /二进制/);
  assert.throws(() => createPreview('/invalid.txt', 2, Buffer.from([255, 254])), /UTF-8/);
  const empty = createPreview('/empty.txt', 0, Buffer.alloc(0));
  assert.equal(empty.kind, 'text');
});

test('oversized image dimensions are rejected before the renderer decodes the image', () => {
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(100_000, 16);
  oversized.writeUInt32BE(100_000, 20);
  assert.throws(() => createPreview('/huge.png', oversized.length, oversized), /像素尺寸过大/);
  const gif = Buffer.from('R0lGODlhAQABAIAAAP///////yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  assert.equal(createPreview('/picture.gif', gif.length, gif).kind, 'image');
});

test('local previews read regular files only and use device-independent local paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-preview-'));
  try {
    const path = join(directory, 'hello.txt');
    await writeFile(path, '你好 Nexus');
    const result = await previewLocal(path);
    assert.equal(result.kind, 'text');
    if (result.kind === 'text') assert.equal(result.text, '你好 Nexus');
    await assert.rejects(previewLocal(directory));
    assert.equal(localFilePath('C:\\Users\\Tester', 'image.png'), 'C:\\Users\\Tester\\image.png');
    assert.equal(localFilePath('/home/tester/', 'image.png'), '/home/tester/image.png');
    assert.equal(localFilePath('/', 'image.png'), '/image.png');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
