
import { formatUploadBytes } from "./uploadLimits";

export const DIRECT_UPLOAD_MAX_FILE_BYTES = 500 * 1024 * 1024;

export const DIRECT_UPLOAD_MAX_BATCH_BYTES = 1024 * 1024 * 1024;

export const DIRECT_UPLOAD_URL_TTL_SECONDS = 900;

export const DIRECT_UPLOAD_MAX_FILES = 10;

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
  previewOfIndex?: number;
};

export function isPreviewEntry(file: DirectUploadRequestFile): boolean {
  return typeof file.previewOfIndex === "number";
}

export type DirectUploadTicket = {
  uploadUrl: string;
  fileUrl: string;
  contentType: string;
  fileName: string;
  key: string;
};

export function getDirectUploadSizeError(
  files: DirectUploadRequestFile[]
): string | null {
  const pickedCount = files.filter((file) => !isPreviewEntry(file)).length;
  if (pickedCount > DIRECT_UPLOAD_MAX_FILES) {
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
