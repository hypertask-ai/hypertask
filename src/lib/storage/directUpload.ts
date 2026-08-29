/**
 * Presigned direct-to-storage uploads (HTPR-5524).
 *
 * `/api/tasks/n8nUpload` buffers the whole file inside a Vercel Serverless
 * Function, so the platform's 4.5 MB request-body ceiling capped every
 * attachment at 4 MB (HTPR-5516) and made video impossible. The browser now
 * asks `/api/tasks/uploadUrl` for a short-lived signed PUT and sends the bytes
 * straight to storage, so only the small JSON handshake crosses the function.
 *
 * This module is imported by both the browser and the API route, so it must
 * stay free of server-only dependencies.
 */

import { formatUploadBytes } from "./uploadLimits";

/** Per-file ceiling for a direct upload, set by Valentin on HTPR-5524. */
export const DIRECT_UPLOAD_MAX_FILE_BYTES = 500 * 1024 * 1024;

/** Aggregate ceiling for one batch of direct uploads. */
export const DIRECT_UPLOAD_MAX_BATCH_BYTES = 1024 * 1024 * 1024;

/** Lifetime of a signed PUT URL. Long enough for a 200 MB file on slow links. */
export const DIRECT_UPLOAD_URL_TTL_SECONDS = 900;

/** Maximum files in one handshake, matching the existing attachment batch cap. */
export const DIRECT_UPLOAD_MAX_FILES = 10;

/**
 * Types a browser would render instead of download. Storing them under a
 * caller-chosen name on the public attachment host would turn an upload into a
 * hosted page, so they are stored and served as an opaque download instead
 * (same rule as the MCP attachment allowlist).
 */
const RENDERABLE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
]);

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** The exact Content-Type the signed URL is bound to. */
export function directUploadContentType(raw?: string | null): string {
  if (typeof raw !== "string") return DEFAULT_CONTENT_TYPE;
  const normalized = raw.split(";")[0].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    return DEFAULT_CONTENT_TYPE;
  }
  return RENDERABLE_CONTENT_TYPES.has(normalized)
    ? DEFAULT_CONTENT_TYPE
    : normalized;
}

/**
 * Object-key segment for a file name. The public URL helper concatenates keys
 * verbatim, so the segment must contain no character that changes the meaning
 * of an HTTP path.
 */
export function safeDirectUploadNameSegment(fileName: string): string {
  const cleaned = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 120);
  return cleaned || "file";
}

export type DirectUploadRequestFile = {
  name?: string | null;
  size: number;
  type?: string | null;
};

export type DirectUploadTicket = {
  /** Short-lived signed PUT URL. */
  uploadUrl: string;
  /** Public HTTPS URL stored as `Attachment.fileSource` once the PUT succeeds. */
  fileUrl: string;
  /** Header the PUT must send verbatim; the signature covers it. */
  contentType: string;
  fileName: string;
  /** Object key, sent back for server-side size verification and cleanup. */
  key: string;
};

/**
 * Returns a plain-language message when a batch exceeds the direct-upload
 * limits, or null when it is acceptable.
 */
export function getDirectUploadSizeError(
  files: DirectUploadRequestFile[]
): string | null {
  if (files.length > DIRECT_UPLOAD_MAX_FILES) {
    return `A maximum of ${DIRECT_UPLOAD_MAX_FILES} files may be uploaded at once.`;
  }

  const oversized = files.find((file) => file.size > DIRECT_UPLOAD_MAX_FILE_BYTES);
  if (oversized) {
    const label = oversized.name ? `"${oversized.name}"` : "This file";
    return `${label} is ${formatUploadBytes(
      oversized.size
    )}. Files must be under ${formatUploadBytes(DIRECT_UPLOAD_MAX_FILE_BYTES)}.`;
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > DIRECT_UPLOAD_MAX_BATCH_BYTES) {
    return `These files total more than ${formatUploadBytes(
      DIRECT_UPLOAD_MAX_BATCH_BYTES
    )}. Upload them in smaller batches.`;
  }

  return null;
}
