
const RENDERABLE_IMAGE_MIME = new Set([
  "image/png",
  "image/apng",
  "image/jpeg",
  "image/pjpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
]);

const RENDERABLE_IMAGE_EXTENSION = new Set([
  "png",
  "apng",
  "jpg",
  "jpeg",
  "jfif",
  "pjpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
]);

const UNINFORMATIVE_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function extensionOf(fileName?: string | null): string {
  if (!fileName) return "";
  const path = fileName.split(/[?#]/)[0];
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot < 0 || lastDot < lastSlash) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

export function isBrowserRenderableImage(
  mimeType?: string | null,
  fileName?: string | null,
): boolean {
  const mime = (mimeType ?? "").trim().toLowerCase().split(";")[0];

  if (RENDERABLE_IMAGE_MIME.has(mime)) return true;

  if (mime.startsWith("image/")) return false;

  if (UNINFORMATIVE_MIME.has(mime)) {
    return RENDERABLE_IMAGE_EXTENSION.has(extensionOf(fileName));
  }

  return false;
}

const UNRENDERABLE_IMAGE_EXTENSION = new Set([
  "heic",
  "heics",
  "heif",
  "heifs",
  "hif",
  "tif",
  "tiff",
]);

export function isUnrenderableImage(
  mimeType?: string | null,
  fileName?: string | null,
): boolean {
  if (isBrowserRenderableImage(mimeType, fileName)) return false;

  const mime = (mimeType ?? "").trim().toLowerCase().split(";")[0];
  if (mime.startsWith("image/")) return true;

  if (!UNINFORMATIVE_MIME.has(mime)) return false;
  return UNRENDERABLE_IMAGE_EXTENSION.has(extensionOf(fileName));
}
