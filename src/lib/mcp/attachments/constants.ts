/** Decoded / fetched max size per file (15 MB). */
export const MCP_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

/** Aggregate decoded inline-data cap; leaves room under Vercel's JSON body limit. */
export const MCP_ATTACHMENT_MAX_INLINE_BYTES = 3 * 1024 * 1024;

export const MCP_ATTACHMENT_MAX_FILES = 10;

/** Aggregate decoded/fetched bytes retained while prevalidating one batch. */
export const MCP_ATTACHMENT_MAX_BATCH_BYTES = 30 * 1024 * 1024;

/** JSON transport cap, including base64 and request metadata. */
export const MCP_ATTACHMENT_MAX_REQUEST_BYTES = 5 * 1024 * 1024;

/** Fetch timeout (ms). */
export const MCP_ATTACHMENT_FETCH_TIMEOUT_MS = 30_000;

/** Absolute deadline for fetches, uploads, and persistence of one batch. */
export const MCP_ATTACHMENT_BATCH_TIMEOUT_MS = 630_000;

/** Maximum time allowed for one S3-compatible upload request. */
export const MCP_ATTACHMENT_STORAGE_TIMEOUT_MS = 30_000;

export const MCP_ATTACHMENT_MAX_REDIRECTS = 3;

/**
 * Allowed Content-Type values for MCP attachment uploads (align with HTPR-3099).
 * image/gif included for parity with existing MCP comment image handling.
 *
 * Binary archives and application/octet-stream are allowed so build artifacts
 * (APK, zip) can be attached from the CLI/MCP the way the web UI already allows
 * them (HTPR-4577). What stays OUT is the dangerous part: text/html and
 * image/svg+xml would be rendered by the browser rather than downloaded, so
 * they remain rejected. A binary declared octet-stream is stored and served as
 * octet-stream, which browsers download rather than execute.
 */
export const MCP_ATTACHMENT_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-tar',
  'application/vnd.android.package-archive',
  'application/octet-stream',
]);

export function normalizeMime(raw: string): string {
  return raw.split(';')[0].trim().toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return MCP_ATTACHMENT_ALLOWED_MIME.has(normalizeMime(mime));
}
