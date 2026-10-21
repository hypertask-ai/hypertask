export const MCP_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

export const MCP_ATTACHMENT_MAX_INLINE_BYTES = 3 * 1024 * 1024;

export const MCP_ATTACHMENT_MAX_FILES = 10;

export const MCP_ATTACHMENT_MAX_BATCH_BYTES = 30 * 1024 * 1024;

export const MCP_ATTACHMENT_MAX_REQUEST_BYTES = 5 * 1024 * 1024;

export const MCP_ATTACHMENT_FETCH_TIMEOUT_MS = 30_000;

export const MCP_ATTACHMENT_BATCH_TIMEOUT_MS = 630_000;

export const MCP_ATTACHMENT_STORAGE_TIMEOUT_MS = 30_000;

export const MCP_ATTACHMENT_MAX_REDIRECTS = 3;

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
