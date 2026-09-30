export const TEXT_PREVIEW_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
export const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path);
export const previewLimit = (path: string) =>
  isImagePath(path) ? IMAGE_PREVIEW_BYTES : TEXT_PREVIEW_BYTES;
export function localFilePath(directory: string, name: string) {
  const separator = /^[a-z]:[\\/]|^\\\\/i.test(directory) ? '\\' : '/';
  return directory.replace(/[\\/]$/, '') + separator + name;
}
