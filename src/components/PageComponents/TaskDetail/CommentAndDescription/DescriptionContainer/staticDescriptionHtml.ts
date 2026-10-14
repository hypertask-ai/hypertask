import { normalizeRichHtmlForRender } from "@/utils/helperFunctions/normalizeRichHtmlForRender";
import { linkifyHtml } from "@/utils/helperFunctions/linkifyHtml";

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;
const BLOCKS = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li"]);
const INLINE = new Set(["strong", "b", "em", "i", "u", "s", "a", "br"]);
const LINK_ATTRS = /^\s+href="(?:https?:\/\/|mailto:|\/)[^"<>]*"(?:\s+target="_blank")?(?:\s+rel="[^"<>]*")?\s*$/i;
const RAW_BRACKET = /[<>]/;

const LOOSE_WHITESPACE = /[\n\r\t ​]|\s{2}|<(?:p|li|h[1-3])>\s|\s<\/(?:p|li|h[1-3])>|<\/?(?:p|h[1-3]|ul|ol|li)>\s+<|<br\s*\/?>\s|\s<br/i;

const BARE_DOCUMENT = /^<html><head>\s*<\/head>\s*<body>([\s\S]*)<\/body>\s*<\/html>$/i;

function unwrapBareDocument(html: string): string | null {
  const match = BARE_DOCUMENT.exec(html);
  if (!match) return html;
  return /<\/?(?:html|head|body)\b/i.test(match[1]) ? null : match[1].trim();
}

export function isPlainDescriptionHtml(raw: string | null | undefined, appSaved = false): boolean {
  if (!raw || !raw.trim()) return false;
  const html = appSaved ? unwrapBareDocument(raw.trim()) : raw.trim();
  if (!html) return false;
  if (LOOSE_WHITESPACE.test(html)) return false;
  const stack: string[] = [];
  let cursor = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const [, closing, name, attrs] = match;
    const tag = name.toLowerCase();
    if (RAW_BRACKET.test(text)) return false;
    if (stack.length === 0 && text.trim()) return false;
    if (!BLOCKS.has(tag) && !INLINE.has(tag)) return false;
    if (tag === "a") {
      if (!closing && !LINK_ATTRS.test(attrs)) return false;
    } else if (attrs.trim() && !(appSaved && tag === "ol" && attrs === ' class="numbered-list"')) return false;
    if (tag === "br") {
      if (/^\s*<\/p>/i.test(html.slice(cursor))) return false;
      continue;
    }
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      const parent = stack[stack.length - 1];
      if (BLOCKS.has(tag) && tag !== "li" && parent && parent !== "li") return false;
      if (tag === "li" && parent !== "ul" && parent !== "ol") return false;
      if (parent === "li" && /^h[1-3]$/.test(tag)) return false;
      if (INLINE.has(tag) && !parent) return false;
      stack.push(tag);
    }
  }
  if (stack.length || html.slice(cursor).trim()) return false;  return true;
}

const EMPTY_PARAGRAPH = '<p><br class="ProseMirror-trailingBreak"></p>';

export function toEditorHtml(raw: string): string {
  let html = linkifyHtml(normalizeRichHtmlForRender(raw))
    .replace(/<(\/?)b>/g, "<$1strong>")
    .replace(/<(\/?)i>/g, "<$1em>")
    .replace(/<ol>/g, '<ol class="numbered-list">')
    .replace(/<a href="([^"]*)">/g, '<a target="_blank" rel="noopener noreferrer nofollow" href="$1">')
    .replace(/<p>\s*<\/p>/g, EMPTY_PARAGRAPH);
  if (!html.endsWith("</p>")) html += EMPTY_PARAGRAPH;
  return html;
}
