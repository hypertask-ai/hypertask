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
export const MORE_ENTRY_TITLE = "More changes";
export const MAX_TOPIC_ENTRIES = 10;

const MAX_TITLE_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 170;
const MAX_LISTED_TITLES = 4;
const MAX_MORE_TITLES = 6;

const HTML_BREAKS = /<(?:br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi;
const HTML_TAG = /<[^>]*>/g;
const LEADING_FIELD =
  /^(?:what'?s wrong or wanted|what is wrong or wanted|what'?s needed|what we want|problem|who it affects|recommended course and why)\s*:\s*/i;
const NEXT_FIELD =
  /\b(?:who it affects|recommended course and why|what valentin must decide|how to undo|done when|risk|decision|how it works today|fix)\s*:/i;
const TITLE_PREFIX = /^(?:\[[^\]]{1,40}\]\s*|[A-Z][A-Z0-9]*-\d+\s+)/;

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
  let stripped = plainText(title);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = stripped.replace(TITLE_PREFIX, "").trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped;
}

export function entryTitle(title: string): string {
  const plain = plainText(title);
  return clipAtWord(stripTitlePrefixes(title) || plain, MAX_TITLE_LENGTH);
}

export function entrySummary(description: string): string {
  const text = plainText(description);
  if (!text) return "";
  const trimmed = text.replace(LEADING_FIELD, "");
  const firstField = trimmed.search(NEXT_FIELD);
  const scope = firstField > 20 ? trimmed.slice(0, firstField) : trimmed;
  const sentence = scope.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? scope;
  return clipAtWord(sentence.trim(), MAX_SUMMARY_LENGTH);
}

function listedTitles(tickets: readonly ShippedTicket[], limit: number, tail: string): string {
  const titles = tickets.slice(-limit).map((ticket) => entryTitle(ticket.title));
  const extra = tickets.length - titles.length;
  const listed = titles.join("; ");
  return extra > 0 ? `${listed}, and ${extra} more ${tail}.` : listed;
}

function fixesContent(tickets: readonly ShippedTicket[]): string {
  return listedTitles(tickets, MAX_LISTED_TITLES, "small fixes");
}

function moreContent(tickets: readonly ShippedTicket[]): string {
  return listedTitles(tickets, MAX_MORE_TITLES, "changes");
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
  const topics = sorted.filter((ticket) => ticket.kind !== "fix");
  const fixes = sorted.filter((ticket) => ticket.kind === "fix");
  const entries: DigestEntry[] = [];
  const overflow = topics.slice(0, Math.max(0, topics.length - maxTopics));
  const kept = topics.slice(Math.max(0, topics.length - maxTopics));

  for (const ticket of kept) {
    const summary = entrySummary(ticket.description) || "Shipped in Hypertask.";
    entries.push(toEntry(entryTitle(ticket.title), summary, [ticket]));
  }
  if (overflow.length) {
    entries.push(
      toEntry(
        MORE_ENTRY_TITLE,
        moreContent(overflow),
        overflow,
      ),
    );
  }
  if (fixes.length) {
    entries.push(toEntry(FIXES_ENTRY_TITLE, fixesContent(fixes), fixes));
  }

  return entries.sort((left, right) => left.releasedAt.getTime() - right.releasedAt.getTime());
}
