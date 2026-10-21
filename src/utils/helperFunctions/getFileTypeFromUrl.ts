const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

export const IMAGE_FALLBACK_MIME = "image/png";

export function getFileTypeFromUrl(
  url: string,
  fallback = "application/octet-stream"
): string {
  const path = url.split(/[?#]/)[0];
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot < 0 || lastDot < lastSlash) return fallback;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? fallback;
}
