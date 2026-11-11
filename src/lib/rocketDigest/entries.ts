export type TicketKind = "feature" | "improvement" | "fix";

export type ShippedTicket = {
  uniqueIndex: number;
  title: string;
  description: string;
  releasedAt: Date;
  kind: TicketKind;
};

export type DigestEntry = {
  title: string;
  content: string;
  releasedAt: Date;
  ticketIds: number[];
};

export const FIXES_ENTRY_TITLE = "Fixes & polish";
export const DIGEST_VERSION = 4;
export const MAX_TOPIC_ENTRIES = 12;
export const MAX_CATCHUP_TOPIC_ENTRIES = 40;

const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 170;
const MAX_LISTED_TITLES = 4;
const MIN_SUMMARY_WORDS = 4;

const HTML_BREAKS = /<(?:br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi;
const HTML_TAG = /<[^>]*>/g;
const FLAG_MODE = "(?:everyone|internal|off|qa|owner|only me \\+ qa)";
const FLAG_NOTE = new RegExp(
  `(?:^|(?<=[.!?]\\s))\\s*flag:\\s*(?:https?:\\/\\/\\S+|${FLAG_MODE})\\s*(?:\\([^)]{0,40}\\))?\\s*`,
  "gi",
);
const LEADING_FIELD =
  /^(?:what'?s wrong or wanted|what is wrong or wanted|what'?s needed|what we want|what'?s new|problem|summary|who it affects|recommended course and why)\s*:?\s*/i;
const NEXT_FIELD =
  /\b(?:who it affects|recommended course and why|what valentin must decide|how to undo|done when|risk|decision|how it works today|board)\s*:/i;
const POINTER_ONLY =
  /^(?:follow[- ]?up\b|see\b|refs?\b|part of\b|related to\b|blocked by\b|as discussed\b|ready to build\b|now ready to build\b|n\/a\b)/i;
const TITLE_PREFIX = /^(?:\[[^\]]{1,40}\]\s*|[A-Z][A-Z0-9]*-\d+\s+)/;
const BARE_URL = /https?:\/\/\S+/gi;
const FLAG_PROSE = /\s*[—–-]?\s*\b(?:everyone|only me \+ qa|internal|off|qa|owner)\b when released\b\.?/gi;
const MENTION = /^@[\w.'-]+/;
const MENTION_WORD = /^\s+([A-Z][\w.'-]*)/;
const MENTION_STOP = new Set([
  "a",
  "add",
  "allow",
  "an",
  "and",
  "apply",
  "at",
  "build",
  "cap",
  "create",
  "fix",
  "for",
  "from",
  "give",
  "in",
  "keep",
  "let",
  "make",
  "move",
  "on",
  "open",
  "prevent",
  "put",
  "remove",
  "run",
  "send",
  "show",
  "sort",
  "stop",
  "switch",
  "the",
  "to",
  "track",
  "turn",
  "use",
  "when",
  "with",
  "write",
]);
const TICKET_PARENTHETICAL = /\s*\([^()]*\b[A-Z]{2,}[A-Z0-9]*-\d+\b[^()]*\)/g;
const FIRST_FIELD_LABEL =
  /\b(?:what'?s wrong or wanted|what is wrong or wanted|what'?s needed|what we want)\s*:/i;
const CHATTER =
  /^(?:@[\w.-]+|i\b|valentin(?:'s)?\b|this is his own ask\b)/i;
const FIELD_LABEL =
  /^(?:what'?s wrong or wanted|what is wrong or wanted|who it affects|recommended course and why|what valentin must decide|how to undo|done when|risk|decision|problem|summary|how it works today)\b/i;

export function plainText(html: string): string {
  return html
    .replace(HTML_BREAKS, " ")
    .replace(HTML_TAG, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function clipAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

function stripTitlePrefixes(title: string): string {
  let stripped = plainText(title).replace(TICKET_PARENTHETICAL, "").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = stripped.replace(TITLE_PREFIX, "").trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped;
}

function stripLeadingFields(text: string): string {
  let stripped = text.trim();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = stripped.replace(LEADING_FIELD, "").trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped;
}

function stripMention(text: string): string {
  const mention = text.match(MENTION);
  if (!mention) return text;
  let rest = text.slice(mention[0].length);
  for (let extra = 0; extra < 3; extra += 1) {
    const word = rest.match(MENTION_WORD);
    if (!word || MENTION_STOP.has(word[1].toLowerCase())) break;
    rest = rest.slice(word[0].length);
  }
  return rest.trimStart();
}

function cleanSentence(piece: string): string {
  return stripMention(piece.trim())
    .replace(/^now:\s*/i, "")
    .trim();
}

function firstUsableSentence(text: string): string {
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    const sentence = cleanSentence(piece);
    if (!sentence || POINTER_ONLY.test(sentence)) continue;
    if (CHATTER.test(sentence) || FIELD_LABEL.test(sentence)) continue;
    if (sentence.split(/\s+/).length < MIN_SUMMARY_WORDS) continue;
    return sentence;
  }
  return "";
}

function asSentenceCase(text: string): string {
  return /^[a-z]/.test(text) ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

export function entryTitle(title: string): string {
  const plain = plainText(title);
  return clipAtWord(stripTitlePrefixes(title) || plain, MAX_TITLE_LENGTH);
}

export function entrySummary(description: string): string {
  const cleaned = plainText(description)
    .replace(FLAG_NOTE, "")
    .replace(FLAG_PROSE, ".")
    .replace(BARE_URL, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
  const label = cleaned.search(FIRST_FIELD_LABEL);
  const text = stripMention((label > 0 ? cleaned.slice(label) : cleaned).trim());
  if (!text) return "";
  const trimmed = stripLeadingFields(text);
  const firstField = trimmed.search(NEXT_FIELD);
  const scope = firstField > 20 ? trimmed.slice(0, firstField) : trimmed;
  const sentence = firstUsableSentence(scope) || firstUsableSentence(trimmed);
  return sentence ? clipAtWord(asSentenceCase(sentence), MAX_SUMMARY_LENGTH) : "";
}

function fixesContent(tickets: readonly ShippedTicket[]): string {
  return tickets
    .slice(-MAX_LISTED_TITLES)
    .map((ticket) => entryTitle(ticket.title))
    .join("; ");
}

function toEntry(title: string, content: string, tickets: ShippedTicket[]): DigestEntry {
  return {
    title,
    content,
    releasedAt: new Date(Math.max(...tickets.map((ticket) => ticket.releasedAt.getTime()))),
    ticketIds: tickets.map((ticket) => ticket.uniqueIndex),
  };
}

export function buildDigestEntries(
  tickets: readonly ShippedTicket[],
  { maxTopics = MAX_TOPIC_ENTRIES }: { maxTopics?: number } = {},
): DigestEntry[] {
  const sorted = [...tickets].sort(
    (left, right) => left.releasedAt.getTime() - right.releasedAt.getTime(),
  );
  const entries: DigestEntry[] = [];

  const candidates = sorted
    .filter((ticket) => ticket.kind !== "fix")
    .map((ticket) => ({ ticket, summary: entrySummary(ticket.description) }))
    .filter((candidate) => Boolean(candidate.summary));
  const topics = maxTopics > 0 ? candidates.slice(-maxTopics) : [];

  for (const { ticket, summary } of topics) {
    entries.push(toEntry(entryTitle(ticket.title), summary, [ticket]));
  }

  const fixes = sorted.filter((ticket) => ticket.kind === "fix");
  if (fixes.length) {
    entries.push(toEntry(FIXES_ENTRY_TITLE, fixesContent(fixes), [...fixes]));
  }

  return entries.sort((left, right) => left.releasedAt.getTime() - right.releasedAt.getTime());
}
