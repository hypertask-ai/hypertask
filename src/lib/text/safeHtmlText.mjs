export const MAX_CHECK_TEXT_LENGTH = 100_000;

export function dropBlockquotes(html) {
  const lower = html.toLowerCase();
  const opening = /<blockquote\b/gi;
  const parts = [];
  let start = 0;
  let match;
  while ((match = opening.exec(html)) !== null) {
    const close = lower.indexOf("</blockquote>", opening.lastIndex);
    if (close === -1) break;
    parts.push(html.slice(start, match.index), "\n");
    start = close + 13;
    opening.lastIndex = start;
  }
  parts.push(html.slice(start));
  return parts.join("");
}

export function stripTags(html) {
  const parts = [];
  let start = 0;
  let open = html.indexOf("<");
  while (open !== -1) {
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    if (close > open + 1) {
      parts.push(html.slice(start, open), " ");
      start = close + 1;
    }
    open = html.indexOf("<", close + 1);
  }
  parts.push(html.slice(start));
  return parts.join("");
}
