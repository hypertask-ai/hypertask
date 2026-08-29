// UTF-8-safe base64 for the HTML-block payload. The raw agent HTML is stored as
// an opaque base64 attribute value so TipTap's schema never parses (and never
// strips) it, and so it can never execute if contentHtml is ever rendered
// outside the sandboxed iframe. Must stay byte-identical to the server codec in
// src/utils/controllers/pages/htmlCanvas.ts (standard base64 alphabet).

export function encodeHtmlPayload(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeHtmlPayload(b64: string): string {
  if (!b64) return "";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
