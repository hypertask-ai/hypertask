
export const UPLOAD_MAX_REQUEST_BYTES = Math.floor(4.5 * 1024 * 1024);

export const UPLOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;

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

export function estimateUploadRequestBytes(sizes: number[]): number {
  return sizes.reduce(
    (total, size) => total + size + MULTIPART_OVERHEAD_PER_FILE,
    0
  );
}

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

export const UPLOAD_TOO_LARGE_MESSAGE = `That upload is too large. Files must be under ${formatUploadBytes(
  UPLOAD_MAX_FILE_BYTES
)}.`;
