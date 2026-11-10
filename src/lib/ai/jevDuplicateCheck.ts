export const JEV_DUPLICATE_MIN_CONFIDENCE = 0.9;
export const JEV_DUPLICATE_CALL_TIMEOUT_MS = 900;
export const JEV_DUPLICATE_TEXT_LIMIT = 800;

export type JevDuplicateDraft = { title: string; description: string };

export type JevDuplicateCandidate = { ticketNumber: string; url: string; title: string; description: string };

export type JevDuplicateVerdict = { same: boolean; confidence: number | null };

export type JevDuplicateMatch = { ticketNumber: string; url: string; title: string; confidence: number };

const SAME_WORDS = /\b(yes|same|duplicate|identical|matches)\b/i;
const DIFFERENT_WORDS = /\b(no|different|unrelated|separate|distinct)\b/i;

export function jevPlainText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, JEV_DUPLICATE_TEXT_LIMIT);
}

export function buildJevDuplicatePrompt(
  draft: JevDuplicateDraft,
  candidate: JevDuplicateCandidate
) {
  return `Two tickets. Do they describe the same work?
Answer on one line: yes or no, then a confidence from 0 to 1.
Same work means the same user action, the same part of the product and the same outcome. A follow-up, a rerun, a new experiment or extra detail is not the same work.

NEW: ${draft.title}
${jevPlainText(draft.description)}

EARLIER ${candidate.ticketNumber}: ${candidate.title}
${jevPlainText(candidate.description)}`;
}

export function parseJevVerdict(
  text: string | null | undefined
): JevDuplicateVerdict | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  const percent = value.match(/(\d{1,3})\s*%/);
  const decimal = value.match(/\b(?:0?\.\d+|1(?:\.0+)?)\b/);
  const raw = percent ? Number(percent[1]) / 100 : decimal ? Number(decimal[0]) : NaN;
  const confidence = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : null;
  if (DIFFERENT_WORDS.test(value)) return { same: false, confidence };
  if (SAME_WORDS.test(value)) return { same: true, confidence };
  return confidence === null ? null : { same: true, confidence };
}

export function selectJevDuplicateMatch(
  results: Array<{
    candidate: JevDuplicateCandidate;
    verdict: JevDuplicateVerdict | null;
  }>
): JevDuplicateMatch | null {
  const matches: JevDuplicateMatch[] = [];
  for (const { candidate, verdict } of results) {
    const confidence = verdict?.confidence ?? 0;
    if (!verdict?.same || confidence < JEV_DUPLICATE_MIN_CONFIDENCE) continue;
    matches.push({
      ticketNumber: candidate.ticketNumber,
      url: candidate.url,
      title: candidate.title,
      confidence,
    });
  }
  matches.sort((left, right) => right.confidence - left.confidence);
  return matches[0] ?? null;
}

export function formatDuplicateCheckHint(match: JevDuplicateMatch | null) {
  if (!match) return "";
  return [
    "<DUPLICATE_CHECK>",
    `ticketNumber:${match.ticketNumber}`,
    `url:${match.url}`,
    `title:${match.title}`,
    `confidence:${match.confidence.toFixed(2)}`,
    "</DUPLICATE_CHECK>",
  ].join("\n");
}
