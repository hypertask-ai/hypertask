import { normalizeRichHtmlForRender } from "@/utils/helperFunctions/normalizeRichHtmlForRender";
import { linkifyHtml } from "@/utils/helperFunctions/linkifyHtml";

// HTPR-7091: the editor chunk is slow to arrive on a phone, so a cold ticket
// shows its description as static HTML first. That is only invisible when the
// static HTML is exactly what the editor will show, so this covers the plain
// subset (paragraphs, headings, lists, bold, italic, underline, strike, links,
// line breaks). Anything else (images, mentions, code, quotes, embeds, styled
// or unknown markup) keeps today's editor-first path.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;
const BLOCKS = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li"]);
const INLINE = new Set(["strong", "b", "em", "i", "u", "s", "a", "br"]);
const LINK_ATTRS = /^\s+href="[^"<>]*"(?:\s+target="_blank")?(?:\s+rel="[^"<>]*")?\s*$/;

// The editor collapses stray whitespace while it parses; the static copy would
// keep it (the editor's own style preserves spaces), so any such whitespace
// sends the description to the editor-first path.
const LOOSE_WHITESPACE = /[\n\r\t ​]|\s{2}|<(?:p|li|h[1-3])>\s|\s<\/(?:p|li|h[1-3])>|<\/?(?:p|h[1-3]|ul|ol|li)>\s+<|<br\s*\/?>\s|\s<br/i;

export function isPlainDescriptionHtml(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  const html = raw.trim();
  if (LOOSE_WHITESPACE.test(html)) return false;
  const stack: string[] = [];
  let cursor = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const text = html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const [, closing, name, attrs] = match;
    const tag = name.toLowerCase();
    // Loose text outside a block would be wrapped by the editor, not by us.
    if (stack.length === 0 && text.trim()) return false;
    if (!BLOCKS.has(tag) && !INLINE.has(tag)) return false;
    if (tag === "a") {
      if (!closing && !LINK_ATTRS.test(attrs)) return false;
    } else if (attrs.trim()) return false;
    if (tag === "br") {
      // A break at the end of a paragraph renders differently in the editor.
      if (/^\s*<\/p>/i.test(html.slice(cursor))) return false;
      continue;
    }
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      // Blocks only open at the top or inside a list item; inline marks inside a block.
      const parent = stack[stack.length - 1];
      if (BLOCKS.has(tag) && tag !== "li" && parent && parent !== "li") return false;
      if (tag === "li" && parent !== "ul" && parent !== "ol") return false;
      if (parent === "li" && /^h[1-3]$/.test(tag)) return false;
      if (INLINE.has(tag) && !parent) return false;
      stack.push(tag);
    }
  }
  if (stack.length || html.slice(cursor).trim()) return false;
  return true;
}

const EMPTY_PARAGRAPH = '<p><br class="ProseMirror-trailingBreak"></p>';

/** The markup the read-only editor produces for plain content. */
export function toEditorHtml(raw: string): string {
  let html = linkifyHtml(normalizeRichHtmlForRender(raw))
    .replace(/<(\/?)b>/g, "<$1strong>")
    .replace(/<(\/?)i>/g, "<$1em>")
    .replace(/<ol>/g, '<ol class="numbered-list">')
    // The editor's link mark opens links in a new tab.
    .replace(/<a href="([^"]*)">/g, '<a target="_blank" rel="noopener noreferrer nofollow" href="$1">')
    .replace(/<p>\s*<\/p>/g, EMPTY_PARAGRAPH);
  if (!html.endsWith("</p>")) html += EMPTY_PARAGRAPH;
  return html;
}
