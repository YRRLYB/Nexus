import { open } from 'node:fs/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { FilePreview } from '../shared/types';
import { isImagePath, previewLimit, IMAGE_PREVIEW_BYTES } from '../shared/preview';

function imageMime(buffer: Buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

function imageDimensions(buffer: Buffer, mime: string): [number, number] | undefined {
  if (mime === 'image/png') return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  if (mime === 'image/gif' && buffer.length >= 10)
    return [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
  if (mime === 'image/webp') {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8X' && buffer.length >= 30)
      return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
    if (format === 'VP8L' && buffer.length >= 25 && buffer[20] === 47) {
      const dimensions = buffer.readUInt32LE(21);
      return [(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1];
    }
    if (format === 'VP8 ' && buffer.length >= 30)
      return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 3 < buffer.length) {
      if (buffer[offset++] !== 255) continue;
      while (buffer[offset] === 255) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      )
        return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  return undefined;
}

export function createPreview(path: string, size: number, buffer: Buffer): FilePreview {
  const limit = previewLimit(path);
  const truncated = size > limit || buffer.length > limit;
  const content = buffer.subarray(0, limit);
  const mime = imageMime(content);
  if (mime) {
    if (size > IMAGE_PREVIEW_BYTES || truncated)
      throw new Error('图片预览上限为 8 MB，请下载后查看');
    const dimensions = imageDimensions(content, mime);
    if (!dimensions || dimensions.some((value) => !value))
      throw new Error('无法读取图片尺寸，文件可能已损坏');
    if (dimensions[0] * dimensions[1] > 40_000_000 || dimensions.some((value) => value > 16384))
      throw new Error('图片像素尺寸过大，请下载后查看');
    return {
      path,
      size,
      truncated: false,
      kind: 'image',
      mime,
      data: `data:${mime};base64,${content.toString('base64')}`,
    };
  }
  if (isImagePath(path)) throw new Error('图片格式无效；仅支持 PNG、JPEG、GIF、WebP');
  if (content.some((value) => value < 32 && ![9, 10, 13].includes(value)))
    throw new Error('二进制文件不支持预览，请下载后查看');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: truncated });
  } catch {
    throw new Error('文本不是 UTF-8 编码，请下载后使用编辑器查看');
  }
  return { path, size, truncated, kind: 'text', text };
}

export async function previewLocal(path: string): Promise<FilePreview> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('仅支持预览普通文件');
    if (isImagePath(path) && info.size > IMAGE_PREVIEW_BYTES)
      throw new Error('图片预览上限为 8 MB，请下载后查看');
    const buffer = Buffer.alloc(previewLimit(path) + 1);
    let received = 0;
    while (received < buffer.length) {
      const result = await handle.read(buffer, received, buffer.length - received, received);
      if (!result.bytesRead) break;
      received += result.bytesRead;
    }
    return createPreview(path, info.size, buffer.subarray(0, received));
  } finally {
    await handle.close();
  }
}

export async function previewSFTP(sftp: SFTPWrapper, path: string): Promise<FilePreview> {
  const handle = await new Promise<Buffer>((resolve, reject) =>
    sftp.open(path, 'r', (error, value) => (error ? reject(error) : resolve(value))),
  );
  try {
    const info = await new Promise<Stats>((resolve, reject) =>
      sftp.fstat(handle, (error, value) => (error ? reject(error) : resolve(value))),
    );
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0)
      throw new Error('仅支持预览普通文件');
    if (isImagePath(path) && info.size > IMAGE_PREVIEW_BYTES)
      throw new Error('图片预览上限为 8 MB，请下载后查看');
    const buffer = Buffer.alloc(previewLimit(path) + 1);
    let received = 0;
    while (received < buffer.length) {
      const count = await new Promise<number>((resolve, reject) =>
        sftp.read(
          handle,
          buffer,
          received,
          Math.min(32 * 1024, buffer.length - received),
          received,
          (error, value) => (error ? reject(error) : resolve(value)),
        ),
      );
      if (!count) break;
      received += count;
    }
    return createPreview(path, info.size, buffer.subarray(0, received));
  } finally {
    await new Promise<void>((resolve) => sftp.close(handle, () => resolve()));
  }
}
