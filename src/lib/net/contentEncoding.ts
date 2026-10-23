export const DECODABLE_CONTENT_ENCODINGS = ["gzip", "x-gzip", "deflate"] as const;

export function contentEncodings(headerValue: string | null | undefined): string[] {
  return (headerValue ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== "identity");
}

export const MAX_CONTENT_ENCODING_LAYERS = 5;

export function refusedContentEncoding(headerValue: string | null | undefined): string | undefined {
  const encodings = contentEncodings(headerValue);
  if (encodings.length > MAX_CONTENT_ENCODING_LAYERS) return encodings.join(", ");
  return encodings.find(
    (encoding) => !(DECODABLE_CONTENT_ENCODINGS as readonly string[]).includes(encoding),
  );
}
