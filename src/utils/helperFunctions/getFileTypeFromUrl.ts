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

/** Unknown-extension fallback for a URL taken from an img tag, which is an image by definition. */
export const IMAGE_FALLBACK_MIME = "image/png";

/**
 * MIME type of a hosted attachment, from its file extension.
 *
 * The obvious alternative, fetching the file and reading `blob.type`, cannot work in the
 * browser: attachments live on files.hypertask.app, which serves no CORS header, so
 * `fetch()` throws "Failed to fetch" (an image tag still renders it, which is why the
 * breakage only showed up once AI touched the file). Every AI surface that did that fetch
 * died before reaching the API on any task holding a pasted image (HTPR-4735).
 *
 * Pass `fallback: IMAGE_FALLBACK_MIME` when the URL came from an img tag. Upload code
 * keeps the caller's file name verbatim, so an extensionless file is possible, and
 * "application/octet-stream" is not a harmless guess: callers filter on
 * `mimeType.startsWith("image/")`, so the image would be dropped before the request, and
 * declaring it to the model returns an empty completion (measured against production).
 * A wrong image *subtype* costs nothing by the same measurement, so guessing png beats
 * losing the image.
 *
 * Lives in its own module rather than helperFunctions.ts so tests can load it without
 * pulling that file's Prisma import graph along with it.
 */
export function getFileTypeFromUrl(
  url: string,
  fallback = "application/octet-stream"
): string {
  const path = url.split(/[?#]/)[0];
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  // A dot in a parent directory ("/v1.2/screenshot") is not an extension.
  if (lastDot < 0 || lastDot < lastSlash) return fallback;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? fallback;
}
