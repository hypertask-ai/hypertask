/**
 * Turns chat message text into text/link segments so the Agent Chat view can
 * render bare URLs and ticket ids (HTPR-1234) as clickable links without
 * rendering markdown. Also used to find the links in the latest message for
 * the "open all links" shortcut.
 */

export type TMessageLinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;
const TICKET_PATTERN = /\b[A-Z]{2,10}-\d+\b/g;
// Sentence punctuation a URL match's greedy tail commonly swallows ("see
// https://x.com." or "really? https://x.com!") and that is never a valid
// trailing URL character in practice.
const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

/**
 * Resolves a ticket prefix (e.g. "HTPR") to its project id, or undefined if
 * the caller has no project loaded for that prefix. An unresolved ticket id
 * stays plain text rather than linking to a guessed board.
 */
export type TProjectIdForPrefix = (prefix: string) => number | undefined;

export function tokenizeMessageLinks(
  text: string,
  projectIdForPrefix: TProjectIdForPrefix = () => undefined,
): TMessageLinkSegment[] {
  const found: { start: number; end: number; value: string; href: string }[] = [];

  for (const m of text.matchAll(URL_PATTERN)) {
    const start = m.index as number;
    const trimmed = m[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) continue; // the whole match was punctuation (never happens: starts with "http")
    found.push({
      start,
      end: start + trimmed.length,
      value: trimmed,
      href: trimmed,
    });
  }
  for (const m of text.matchAll(TICKET_PATTERN)) {
    const start = m.index as number;
    const end = start + m[0].length;
    // A ticket id that a URL match already covers (rare) is not a second link.
    if (found.some((f) => start < f.end && end > f.start)) continue;
    const prefix = m[0].slice(0, m[0].indexOf("-"));
    const projectId = projectIdForPrefix(prefix);
    if (projectId === undefined) continue;
    const number = m[0].slice(prefix.length + 1);
    found.push({
      start,
      end,
      value: m[0],
      href: `https://app.hypertask.ai/detail/project-${projectId}/${number}`,
    });
  }
  found.sort((a, b) => a.start - b.start);

  const segments: TMessageLinkSegment[] = [];
  let cursor = 0;
  for (const f of found) {
    if (f.start < cursor) continue; // overlapping match, already covered
    if (f.start > cursor) segments.push({ type: "text", value: text.slice(cursor, f.start) });
    segments.push({ type: "link", value: f.value, href: f.href });
    cursor = f.end;
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  return segments;
}

/** Every linkable URL/ticket id in a message, in reading order. */
export function extractMessageLinks(
  text: string,
  projectIdForPrefix: TProjectIdForPrefix = () => undefined,
): string[] {
  return tokenizeMessageLinks(text, projectIdForPrefix)
    .filter((s): s is Extract<TMessageLinkSegment, { type: "link" }> => s.type === "link")
    .map((s) => s.href);
}
