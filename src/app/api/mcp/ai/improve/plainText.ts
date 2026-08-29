// A bare `/<[a-z][\s\S]*>/` also matches ordinary prose like "a<b and c>d",
// "<username>", or "Alice <alice@example.com>" - anything with a stray angle
// bracket. Require an actual element from the tag set Tiptap output uses,
// with only quoted key="value" attributes (never bare words), plus closing
// tags and comments.
const TAG_NAMES =
  "p|h[1-6]|ul|ol|li|a|strong|em|b|i|u|s|del|ins|mark|sub|sup|blockquote|" +
  "code|pre|span|div|br|hr|img|video|iframe|audio|embed|table|thead|tbody|" +
  "tr|td|th|figure|figcaption|section|article|header|footer|nav|aside|main|" +
  "small|big";
const ATTR = `\\s+[a-z-]+=(?:"[^"]*"|'[^']*')`;
const HTML_TAG_RE = new RegExp(
  `<(?:${TAG_NAMES})(?:${ATTR})*\\s*/?>` + // opening or self-closing tag
    `|<\\/(?:${TAG_NAMES})\\s*>` + // closing tag
    `|<!--[\\s\\S]*?-->`, // comment
  "i"
);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// CLI callers pass plain text, not editor HTML. normalizeTiptapOutput compares
// output against the original HTML for image-preservation, so plain text needs
// wrapping (and escaping) into a real <p> before it reaches the model.
// ponytail: duplicates editorAi.ts's escapeHtml on purpose. Kept in its own
// file with zero imports so this pure function stays unit-testable without
// pulling in the prisma-importing chain (route.ts -> mcp/auth -> prisma).
export function toEditableHtml(text: string): string {
  if (HTML_TAG_RE.test(text)) return text;
  return `<p>${escapeHtml(text)}</p>`;
}
