export const SKILL_OFFER_MIN_OCCURRENCES = 5;
export const SKILL_OFFER_MIN_SESSIONS = 3;
export const SKILL_OFFER_WINDOW_DAYS = 30;
export const SKILL_OFFER_MAX_SOURCES = 80;
export const SKILL_OFFER_MAX_SESSIONS = 200;
export const SKILL_OFFER_MAX_QUOTES = 6;
export const SKILL_OFFER_MIN_QUOTE_LENGTH = 12;
export const SKILL_OFFER_MAX_QUOTE_LENGTH = 300;
export const SKILL_OFFER_MAX_RULE_LENGTH = 200;
export const SKILL_OFFER_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SKILL_OFFER_SCAN_COOLDOWN_SECONDS = 6 * 60 * 60;

export type SkillOfferKind = "skill" | "memory";

export type SkillOfferQuote = { messageId: string; quote: string };

export type SkillOfferDraft = {
  slug: string;
  name: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
};

export type SkillOfferPattern = {
  key?: string;
  rule: string;
  kind: SkillOfferKind;
  quotes: SkillOfferQuote[];
  draft?: SkillOfferDraft;
};

export type ChatInstructionSource = {
  messageId: string;
  sessionId: string;
  content: string;
};

export type VerifiedSkillOffer = {
  key: string;
  rule: string;
  kind: SkillOfferKind;
  draft: SkillOfferDraft | null;
  quotes: SkillOfferQuote[];
  occurrences: number;
  sessionCount: number;
  sessionIds: string[];
};

export type SkillOfferRecord = VerifiedSkillOffer & {
  id: string;
  userId: number;
  projectId: number;
  sessionId: string;
  createdAt: string;
  status: SkillOfferStatus;
};

export type SkillOfferStatus = "pending" | "drafted" | "dismissed" | "saved";

export type SkillOfferCard = {
  id: string;
  kind: SkillOfferKind;
  rule: string;
  occurrences: number;
  sessionCount: number;
  quotes: string[];
  draft: SkillOfferDraft | null;
  status: SkillOfferStatus;
};

function normalizeOfferText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedKeyText(value: string) {
  return normalizeOfferText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeSkillOfferKey(raw: string | undefined, rule: string) {
  const candidate = normalizedKeyText(raw ?? "").replaceAll(" ", "-");
  if (/^[a-z0-9]+(?:-[a-z0-9]+){1,5}$/.test(candidate)) return candidate;
  const derived = normalizedKeyText(rule).split(" ").slice(0, 6).join("-");
  return derived || "repeated-instruction";
}

function sanitizeQuote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const quote = normalizeOfferText(raw);
  if (quote.length < SKILL_OFFER_MIN_QUOTE_LENGTH) return null;
  return quote.slice(0, SKILL_OFFER_MAX_QUOTE_LENGTH);
}

function sanitizeDraft(raw: unknown): SkillOfferDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const slug = text(body.slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const name = text(body.name);
  const draftBody = text(body.body);
  if (!slug || !name || !draftBody) return null;
  return {
    slug,
    name,
    description: text(body.description) || null,
    argumentHint: text(body.argumentHint) || text(body.argument_hint) || null,
    body: draftBody,
  };
}

export function verifySkillOfferPattern(
  pattern: SkillOfferPattern | null | undefined,
  sources: ChatInstructionSource[],
): VerifiedSkillOffer | null {
  if (!pattern || typeof pattern !== "object") return null;
  const rule = normalizeOfferText(typeof pattern.rule === "string" ? pattern.rule : "");
  if (!rule || rule.length > SKILL_OFFER_MAX_RULE_LENGTH) return null;
  if (pattern.kind !== "skill" && pattern.kind !== "memory") return null;

  const byId = new Map(sources.map((source) => [source.messageId, source]));
  const matched: ChatInstructionSource[] = [];
  const quotes: SkillOfferQuote[] = [];
  const rawQuotes = Array.isArray(pattern.quotes) ? pattern.quotes : [];
  for (const entry of rawQuotes) {
    const messageId = typeof entry?.messageId === "string" ? entry.messageId : "";
    const source = byId.get(messageId);
    const quote = sanitizeQuote(entry?.quote);
    if (!source || !quote) continue;
    if (!normalizeOfferText(source.content).toLowerCase().includes(quote.toLowerCase())) continue;
    if (matched.some((item) => item.messageId === messageId)) continue;
    matched.push(source);
    if (quotes.length < SKILL_OFFER_MAX_QUOTES) quotes.push({ messageId, quote });
  }

  if (matched.length < SKILL_OFFER_MIN_OCCURRENCES) return null;
  const sessionIds = [...new Set(matched.map((source) => source.sessionId))];
  if (sessionIds.length < SKILL_OFFER_MIN_SESSIONS) return null;

  const draft = pattern.kind === "skill" ? sanitizeDraft(pattern.draft) : null;
  if (pattern.kind === "skill" && !draft) return null;

  return {
    key: normalizeSkillOfferKey(pattern.key, rule),
    rule,
    kind: pattern.kind,
    draft,
    quotes,
    occurrences: matched.length,
    sessionCount: sessionIds.length,
    sessionIds,
  };
}

export function skillOfferLink(id: string) {
  return `<p><a href="/ai/skill-offer/${id}">Review skill suggestion</a></p>`;
}

export function extractSkillOfferIds(content: string) {
  const ids = new Set<string>();
  const html = content.replace(
    /<a\s+href=["']\/ai\/skill-offer\/([0-9a-f-]{36})["'][^>]*>[^<]*<\/a>/gi,
    (_match, id: string) => {
      ids.add(id);
      return "";
    },
  );
  return { html, ids: [...ids] };
}
