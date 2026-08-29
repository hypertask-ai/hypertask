/**
 * Browser upload limits for `/api/tasks/n8nUpload` (HTPR-5516).
 *
 * The route runs as a Vercel Serverless Function, and Vercel rejects any
 * request body above 4.5 MB at the platform edge. That rejection is a bare 413
 * the function never sees, so it carries no JSON body the app could explain.
 * Advertising a larger cap therefore produced an opaque "Request failed with
 * status code 413" instead of a usable message. Keep these limits at or below
 * the platform ceiling and validate in the browser before sending.
 *
 * Since HTPR-5524 this is the *fallback* path only. The browser first uploads
 * straight to storage with a signed PUT, which has no serverless body limit;
 * see `directUpload.ts` for the limits that actually face the user.
 */

/** Hard platform ceiling for a serverless function request body. */
export const UPLOAD_MAX_REQUEST_BYTES = Math.floor(4.5 * 1024 * 1024);

/** Per-file cap, leaving room for multipart headers and boundaries. */
export const UPLOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Multipart overhead reserved per file when checking a batch. */
const MULTIPART_OVERHEAD_PER_FILE = 512;

export function formatUploadBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export class UploadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadTooLargeError";
  }
}

/** Estimated multipart request size for a batch of files. */
export function estimateUploadRequestBytes(sizes: number[]): number {
  return sizes.reduce(
    (total, size) => total + size + MULTIPART_OVERHEAD_PER_FILE,
    0
  );
}

/**
 * Returns a plain-language message when the batch cannot be uploaded, or null
 * when it is within limits.
 */
export function getUploadSizeError(
  files: { name?: string; size: number }[]
): string | null {
  const oversized = files.find((file) => file.size > UPLOAD_MAX_FILE_BYTES);
  if (oversized) {
    const label = oversized.name ? `"${oversized.name}"` : "This file";
    return `${label} is ${formatUploadBytes(oversized.size)}. Files must be under ${formatUploadBytes(
      UPLOAD_MAX_FILE_BYTES
    )}.`;
  }

  const total = estimateUploadRequestBytes(files.map((file) => file.size));
  if (total > UPLOAD_MAX_REQUEST_BYTES) {
    return `These files total more than ${formatUploadBytes(
      UPLOAD_MAX_REQUEST_BYTES
    )}. Upload them in smaller batches.`;
  }

  return null;
}

/** Message shown when the server or platform rejects an upload as too large. */
export const UPLOAD_TOO_LARGE_MESSAGE = `That upload is too large. Files must be under ${formatUploadBytes(
  UPLOAD_MAX_FILE_BYTES
)}.`;
