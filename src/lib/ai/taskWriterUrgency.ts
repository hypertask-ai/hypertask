const URGENCY_PHRASES = [
  "urgent(?:ly)?",
  "asap",
  "a\\.s\\.a\\.p",
  "today",
  "right now",
  "immediately",
  "(?<!\\bad[\\s-])blockers?",
  "(?:production|prod)\\s+(?:is\\s+|went\\s+|has\\s+gone\\s+)?down",
  "dringend",
  "sofort",
  "heute",
  "urgente?s?",
  "urgentemente",
  "tout de suite",
  "imm[eé]diatement",
  "aujourd['’]hui",
  "ahora mismo",
  "inmediatamente",
  "hoy",
  "meteen",
  "vandaag",
  "onmiddellijk",
  "agora mesmo",
  "imediatamente",
  "hoje",
  "subito",
  "immediatamente",
  "oggi",
];

const NEGATORS = new Set([
  "not", "no", "never", "non", "without", "nor",
  "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt", "weren't", "werent",
  "don't", "dont", "doesn't", "doesnt", "didn't", "didnt", "won't", "wont", "cannot", "can't", "cant",
  "nicht", "kein", "keine", "keinen", "nie", "niemals",
  "pas", "jamais", "nunca", "niet", "geen",
]);

const URGENCY_RE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${URGENCY_PHRASES.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
const NEGATION_LOOKBACK_WORDS = 3;

function isNegated(text: string, matchIndex: number) {
  const clause = text.slice(0, matchIndex).split(/[.!?;:,\n\r]/).pop() ?? "";
  const words = clause.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  return words.slice(-NEGATION_LOOKBACK_WORDS).some((word) =>
    NEGATORS.has(word.replace(/’/g, "'").replace(/-+$/, "")),
  );
}

export function noteIsUrgent(note: string): boolean {
  if (!note) return false;
  for (const match of note.matchAll(URGENCY_RE)) {
    if (!isNegated(note, match.index ?? 0)) return true;
  }
  return false;
}

export function taskWriterUserNote(body: {
  PROMPT: string;
  userRetrievalTexts: readonly string[];
  taskDescription: string;
}): string {
  if (body.userRetrievalTexts.length) return body.userRetrievalTexts.join("\n");
  return body.taskDescription ? body.PROMPT.split(body.taskDescription).join(" ") : body.PROMPT;
}
