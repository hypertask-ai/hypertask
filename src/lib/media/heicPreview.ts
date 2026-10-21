
import { isHeicByMetadata } from "./heicToJpeg";

export const HEIC_PREVIEW_SUFFIX = ".preview.jpg";

export const HEIC_PREVIEW_CONTENT_TYPE = "image/jpeg";

export function heicPreviewFileName(fileName: string): string {
  return `${fileName}${HEIC_PREVIEW_SUFFIX}`;
}

export function heicPreviewKey(originalKey: string): string {
  return `${originalKey}${HEIC_PREVIEW_SUFFIX}`;
}

export function isHeicPreviewUrl(url?: string | null): boolean {
  return typeof url === "string" && url.endsWith(HEIC_PREVIEW_SUFFIX);
}

export function heicPreviewUrl(
  fileSource?: string | null,
  fileType?: string | null,
  fileName?: string | null,
): string | null {
  if (!fileSource || typeof fileSource !== "string") return null;
  if (isHeicPreviewUrl(fileSource)) return null;
  if (!isHeicByMetadata(fileType, fileName)) return null;
  if (/[?#]/.test(fileSource)) return null;
  return `${fileSource}${HEIC_PREVIEW_SUFFIX}`;
}

export function attachmentDisplaySrc(
  fileSource: string,
  fileType?: string | null,
  fileName?: string | null,
): string {
  return heicPreviewUrl(fileSource, fileType, fileName) ?? fileSource;
}
