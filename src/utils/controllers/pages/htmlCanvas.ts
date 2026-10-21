import { parse } from "node-html-parser";


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

export function wrapHtmlCanvas(raw: string): string {
  return `<div ${TAG_ATTR}="true" ${PAYLOAD_ATTR}="${encodeHtmlPayloadServer(raw)}"></div>`;
}

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

export function extractCanvasText(raw: string): string {
  if (!raw) return "";
  const root = parse(raw, { comment: false, lowerCaseTagName: true });
  root.querySelectorAll("script,style,noscript").forEach((node: any) => node.remove());
  return root.text.replace(/\s+/g, " ").trim();
}
