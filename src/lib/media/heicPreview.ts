/**
 * Where the JPEG copy of a HEIC/HEIF upload lives, and which URL a picture
 * surface should paint.
 *
 * HTPR-6257 solved the broken-image icon by replacing the HEIC with a JPEG at
 * upload time. That works for every render site but throws the original away,
 * so a user who attached a Mac photo could never get the raw file back
 * (HTPR-6264). Both files are now uploaded: the original, untouched, is what
 * the `Attachment` row points at and what the download button serves, and a
 * browser-readable JPEG copy sits beside it in storage.
 *
 * The two are linked by their object key rather than by a database column.
 * `Attachment` has no metadata or thumbnail field, so carrying a `previewUrl`
 * would mean a migration plus a write path change for every caller that creates
 * an attachment. Instead the preview is stored at the original's key with
 * `.preview.jpg` appended, which every render site can compute from the
 * `fileSource` it already has, with no new data and nothing to backfill.
 *
 * The cost of the convention is that the URL is a claim, not a fact: a HEIC
 * uploaded before this shipped, or one whose conversion failed, has no preview
 * object and the request 404s. Every render site therefore keeps the
 * HTPR-6254 download-chip fallback and switches to it on the image's `onError`,
 * so a missing preview lands on exactly the behaviour that shipped before.
 */

import { isHeicByMetadata } from "./heicToJpeg";

/**
 * Appended to the original's object key to locate its JPEG copy.
 *
 * `.jpg` last so storage and any CDN in front of it infer `image/jpeg`, and the
 * whole suffix after the original name so the preview sorts next to its
 * original in a bucket listing.
 */
export const HEIC_PREVIEW_SUFFIX = ".preview.jpg";

/** The MIME type every generated preview is stored and served as. */
export const HEIC_PREVIEW_CONTENT_TYPE = "image/jpeg";

/** The upload-handshake file name that marks an entry as a preview companion. */
export function heicPreviewFileName(fileName: string): string {
  return `${fileName}${HEIC_PREVIEW_SUFFIX}`;
}

/** The object key a preview is stored at, given its original's key. */
export function heicPreviewKey(originalKey: string): string {
  return `${originalKey}${HEIC_PREVIEW_SUFFIX}`;
}

/** True when this URL or key is itself a generated preview rather than an upload. */
export function isHeicPreviewUrl(url?: string | null): boolean {
  return typeof url === "string" && url.endsWith(HEIC_PREVIEW_SUFFIX);
}

/**
 * The URL of the JPEG copy of a HEIC/HEIF file, or null when the file is not
 * one and therefore never has a preview.
 *
 * Deliberately not a promise and never a network call: render sites need an
 * answer during render, and whether the object really exists is settled by the
 * `<img>` that loads it.
 */
export function heicPreviewUrl(
  fileSource?: string | null,
  fileType?: string | null,
  fileName?: string | null,
): string | null {
  if (!fileSource || typeof fileSource !== "string") return null;
  // A preview of a preview is meaningless, and the suffix would compound.
  if (isHeicPreviewUrl(fileSource)) return null;
  if (!isHeicByMetadata(fileType, fileName)) return null;
  // A query string or fragment would end up inside the key. Storage URLs carry
  // neither today, but a signed one would, and silently building a broken key
  // is worse than declining to guess.
  if (/[?#]/.test(fileSource)) return null;
  return `${fileSource}${HEIC_PREVIEW_SUFFIX}`;
}

/**
 * The URL a picture surface should put in its `<img src>`.
 *
 * The JPEG copy for a HEIC, the file itself for everything else. The file name
 * and the download URL are untouched by this on purpose: the user keeps seeing,
 * and keeps getting, the original.
 */
export function attachmentDisplaySrc(
  fileSource: string,
  fileType?: string | null,
  fileName?: string | null,
): string {
  return heicPreviewUrl(fileSource, fileType, fileName) ?? fileSource;
}
