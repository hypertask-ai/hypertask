const OPEN_WORD = /\b(?:unfinished|still open|not finished|not done|incomplete|remains open)\b/i;

export function hasUnfinishedFullDayObservation(text: string): boolean {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|#160);/gi, " ").replace(/\s+/g, " ");
  if (new RegExp(`${OPEN_WORD.source}[^.]{0,80}\\bfull[- ]day observation\\b`, "i").test(plain)) return true;
  return [...plain.matchAll(/\bfull[- ]day observation(?:\s+gate)?\b[^.]{0,80}/gi)].some((match) => OPEN_WORD.test(match[0]));
}
