const IMAGE_PATH_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export function isImageUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;

  try {
    return IMAGE_PATH_RE.test(new URL(value).pathname);
  } catch {
    return false;
  }
}
