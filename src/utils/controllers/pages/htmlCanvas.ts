import { parse } from "node-html-parser";

// Server side of the HTML-block / canvas feature. A "canvas" page stores the
// agent's raw HTML wrapped in a single opaque block element so it survives the
// rich-text sanitizer and the TipTap schema, and is only ever executed inside
// the sandboxed iframe (see src/components/RTE/Extensions/HtmlBlock). The base64
// alphabet here must match the client codec in that folder.

const TAG_ATTR = "data-html-block";
const PAYLOAD_ATTR = "data-html";

export function encodeHtmlPayloadServer(html: string): string {
  return Buffer.from(html, "utf8").toString("base64");
}

export function decodeHtmlPayloadServer(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Wrap raw agent HTML into the single opaque block element that renderPageContent
// stores. The payload is base64 so the sanitizer keeps it verbatim (no <, >, ",
// ' in the base64 alphabet) and never descends into the raw markup.
export function wrapHtmlCanvas(raw: string): string {
  return `<div ${TAG_ATTR}="true" ${PAYLOAD_ATTR}="${encodeHtmlPayloadServer(raw)}"></div>`;
}

// If stored contentHtml is exactly one HTML block (a canvas page), return the
// decoded raw HTML so GET can round-trip what the agent wrote. Otherwise null.
export function decodeHtmlCanvas(contentHtml: string): string | null {
  if (!contentHtml) return null;
  const root = parse(contentHtml, { comment: false, lowerCaseTagName: true });
  const elements = root.childNodes.filter((node: any) => node.nodeType === 1);
  if (elements.length !== 1) return null;

  const el: any = elements[0];
  if (String(el.rawTagName ?? "").toLowerCase() !== "div") return null;
  if (el.getAttribute(TAG_ATTR) == null) return null;

  const payload = el.getAttribute(PAYLOAD_ATTR);
  if (!payload) return null;
  return decodeHtmlPayloadServer(payload);
}

// Plain-text for RAG/search indexing: the human-readable text of the canvas,
// with script/style/noscript content dropped so CSS/JS never pollutes the index.
export function extractCanvasText(raw: string): string {
  if (!raw) return "";
  const root = parse(raw, { comment: false, lowerCaseTagName: true });
  root.querySelectorAll("script,style,noscript").forEach((node: any) => node.remove());
  return root.text.replace(/\s+/g, " ").trim();
}
