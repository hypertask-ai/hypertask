export const DECODABLE_CONTENT_ENCODINGS = ["gzip", "x-gzip", "deflate"] as const;

export function contentEncodings(headerValue: string | null | undefined): string[] {
  return (headerValue ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== "identity");
}

export function refusedContentEncoding(headerValue: string | null | undefined): string | undefined {
  return contentEncodings(headerValue).find(
    (encoding) => !(DECODABLE_CONTENT_ENCODINGS as readonly string[]).includes(encoding),
  );
}
