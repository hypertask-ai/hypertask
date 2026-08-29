import { normalizeMime } from './constants';

function isUtf8Buffer(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort verify file magic matches declared MIME (reduces confused deputy issues).
 */
export function bufferMatchesDeclaredMime(buffer: Buffer, declaredMime: string): boolean {
  const m = normalizeMime(declaredMime);
  if (buffer.length === 0) return false;

  if (m === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (m === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (m === 'image/gif') {
    const head = buffer.subarray(0, 6).toString('ascii');
    return head === 'GIF87a' || head === 'GIF89a';
  }
  if (m === 'image/webp') {
    if (buffer.length < 12) return false;
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }
  if (m === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (m === 'text/plain' || m === 'text/markdown' || m === 'text/csv') {
    return isUtf8Buffer(buffer);
  }
  if (m === 'application/json') {
    if (!isUtf8Buffer(buffer)) return false;
    try {
      JSON.parse(buffer.toString('utf8'));
      return true;
    } catch {
      return false;
    }
  }
  // Zip container: APK, and the zip-compressed aliases. "PK\x03\x04" is the
  // local file header; PK\x05\x06 is an empty archive (HTPR-4577).
  if (
    m === 'application/zip' ||
    m === 'application/x-zip-compressed' ||
    m === 'application/vnd.android.package-archive'
  ) {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
    );
  }
  if (m === 'application/gzip') {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  }
  // tar has no leading magic (the "ustar" marker sits at offset 257) and
  // octet-stream is by definition unknown bytes, so there is nothing to match.
  // Both are stored and served as non-renderable types, so the browser
  // downloads them rather than executing anything.
  if (m === 'application/x-tar' || m === 'application/octet-stream') {
    return true;
  }
  return false;
}
