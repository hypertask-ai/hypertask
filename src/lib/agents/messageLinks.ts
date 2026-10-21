
export type TMessageLinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;
const TICKET_PATTERN = /\b[A-Z]{2,10}-\d+\b/g;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

export type TProjectIdForPrefix = (prefix: string) => number | undefined;

export function tokenizeMessageLinks(
  text: string,
  projectIdForPrefix: TProjectIdForPrefix = () => undefined,
): TMessageLinkSegment[] {
  const found: { start: number; end: number; value: string; href: string }[] = [];

  for (const m of text.matchAll(URL_PATTERN)) {
    const start = m.index as number;
    const trimmed = m[0].replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) continue;
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
    if (f.start < cursor) continue;
    if (f.start > cursor) segments.push({ type: "text", value: text.slice(cursor, f.start) });
    segments.push({ type: "link", value: f.value, href: f.href });
    cursor = f.end;
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  return segments;
}

export function extractMessageLinks(
  text: string,
  projectIdForPrefix: TProjectIdForPrefix = () => undefined,
): string[] {
  return tokenizeMessageLinks(text, projectIdForPrefix)
    .filter((s): s is Extract<TMessageLinkSegment, { type: "link" }> => s.type === "link")
    .map((s) => s.href);
}
