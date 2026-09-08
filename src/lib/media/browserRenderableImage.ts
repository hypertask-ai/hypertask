/**
 * Whether a browser can actually decode an image and paint it in an `<img>` tag.
 *
 * HTPR-6254: a Mac attaches photos as HEIC/HEIF. That MIME type starts with
 * "image/", so every `fileType.startsWith("image/")` check in the app treated it
 * as displayable and rendered an `<img>`. No desktop browser except Safari
 * decodes HEIF, so the user got a broken-image icon in the comment body and in
 * the attachment tile, on a file that had uploaded perfectly well. The same
 * happens with TIFF.
 *
 * "image/*" answers "is this a picture", which is not the question the render
 * sites are asking. This answers theirs: can Chrome/Firefox/Safari paint it.
 * Anything outside the allowlist still uploads and still downloads, it just gets
 * the paperclip file tile instead of a dead `<img>`.
 */

/** Image subtypes every current browser decodes. */
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

/** Extensions matching the set above, for files that arrive without a usable MIME. */
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

/**
 * MIME types a browser file picker or drag-and-drop hands over when it has no
 * opinion. macOS Finder drags in particular can produce an empty `type`, so the
 * file name is the only signal left.
 */
const UNINFORMATIVE_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function extensionOf(fileName?: string | null): string {
  if (!fileName) return "";
  const path = fileName.split(/[?#]/)[0];
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  // A dot in a parent directory ("/v1.2/photo") is not an extension.
  if (lastDot < 0 || lastDot < lastSlash) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

/**
 * True when an `<img src>` will actually paint this file.
 *
 * Pass the file name too whenever you have it: an unknown or missing MIME falls
 * back to the extension, and a HEIC named `.heic` is caught even when the
 * browser declared no type at all.
 */
export function isBrowserRenderableImage(
  mimeType?: string | null,
  fileName?: string | null,
): boolean {
  const mime = (mimeType ?? "").trim().toLowerCase().split(";")[0];

  if (RENDERABLE_IMAGE_MIME.has(mime)) return true;

  // A known-but-unrenderable image subtype (heic, heif, tiff, ...) is a no,
  // whatever the file happens to be named.
  if (mime.startsWith("image/")) return false;

  if (UNINFORMATIVE_MIME.has(mime)) {
    return RENDERABLE_IMAGE_EXTENSION.has(extensionOf(fileName));
  }

  return false;
}
