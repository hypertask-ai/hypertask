import { plainPageName, plainProblem } from "../errors/plainIncident.mjs";
import { MAX_CHECK_TEXT_LENGTH, dropBlockquotes, stripTags } from "../text/safeHtmlText.mjs";

export const PLAIN_LANGUAGE_TICKET_LABELS = [
  "What's wrong or wanted",
  "Who it affects",
  "Recommended course and why",
  "What Valentin must decide",
  "How to undo",
];

const TEMPLATE_DOC = "docs/ticket-template.md";

function labelPattern(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}\\s*:(?=\\s)`, "i");
}

function openingLabelPattern(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`^\\s*${escaped}\\s*:(?=\\s)`, "i");
}

export function ticketOpening(html) {
  html = dropBlockquotes(html);
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) break;
    if (html.startsWith("<!--", start)) {
      const close = html.indexOf("-->", start + 4);
      if (close === -1) break;
      cursor = close + 3;
      continue;
    }
    let quote = "";
    let end = start + 1;
    for (; end < html.length; end += 1) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    const tag = html.slice(start, end + 1);
    if (/^<hr(?=[\s/>])/i.test(tag)) return html.slice(0, start);
    cursor = end + 1;
    const raw = tag.match(/^<(script|style|textarea)(?=[\s>])/i);
    if (raw) {
      const close = html.toLowerCase().indexOf(`</${raw[1].toLowerCase()}`, cursor);
      if (close === -1) break;
      cursor = close;
    }
  }
  return html;
}

function structuredText(html) {
  return stripTags(dropBlockquotes(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n"))
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export class PlainLanguageTicketError extends Error {
  constructor(missing, message = plainLanguageTicketRefusalMessage(missing)) {
    super(message);
    this.missing = missing;
  }
}

export function assertPlainLanguageTicketBlock(html) {
  if (typeof html === "string" && html.length > MAX_CHECK_TEXT_LENGTH) {
    throw new PlainLanguageTicketError([], `Ticket description must be within ${MAX_CHECK_TEXT_LENGTH} characters.`);
  }
  if (!hasPlainLanguageTicketBlock(html ?? "")) {
    throw new PlainLanguageTicketError(missingPlainLanguageTicketLabels(html ?? ""));
  }
}

export function hasPlainLanguageTicketBlock(html) {
  if (typeof html !== "string" || html.length > MAX_CHECK_TEXT_LENGTH || !html.trim()) return false;
  const source = structuredText(ticketOpening(html));
  const trimmed = source.trimStart();
  const opener = openingLabelPattern(PLAIN_LANGUAGE_TICKET_LABELS[0]);
  const atStart = trimmed.match(opener);
  if (!atStart || atStart.index !== 0) return false;
  let end = atStart[0].length;
  for (let index = 1; index < PLAIN_LANGUAGE_TICKET_LABELS.length; index += 1) {
    const match = source.match(labelPattern(PLAIN_LANGUAGE_TICKET_LABELS[index]));
    if (!match || match.index <= end || !source.slice(end, match.index).trim()) return false;
    end = match.index + match[0].length;
  }
  return Boolean(source.slice(end).trim());
}

export function missingPlainLanguageTicketLabels(html) {
  if (typeof html !== "string" || html.length > MAX_CHECK_TEXT_LENGTH || !html.trim()) return [...PLAIN_LANGUAGE_TICKET_LABELS];
  const source = structuredText(ticketOpening(html));
  return PLAIN_LANGUAGE_TICKET_LABELS.filter((label) => !labelPattern(label).test(source));
}

export function plainLanguageTicketRefusalMessage(missing) {
  const list = (missing?.length ? missing : PLAIN_LANGUAGE_TICKET_LABELS).join(", ");
  return (
    `Ticket description must open with the plain-language block from ${TEMPLATE_DOC} ` +
    `(missing: ${list}). Put ids, paths and logs below a divider.`
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function renderPlainLanguageTicketDescription(fields = {}) {
  const values = {
    "What's wrong or wanted": fields.whatWrongOrWanted ?? "",
    "Who it affects": fields.whoItAffects ?? "",
    "Recommended course and why": fields.recommendedCourseAndWhy ?? "",
    "What Valentin must decide": fields.whatValentinMustDecide ?? "",
    "How to undo": fields.howToUndo ?? "",
  };
  const parts = PLAIN_LANGUAGE_TICKET_LABELS.map(
    (label) => `<p><strong>${label}:</strong> ${escapeHtml(values[label])}</p>`,
  );
  return `${parts.join("")}<hr>`;
}

export function plainLanguageIncidentFields(alert) {
  if (alert?.plain_language_ticket && typeof alert.plain_language_ticket === "object") {
    return alert.plain_language_ticket;
  }
  const users = alert?.users;
  const unidentified = alert?.unidentified_hits;
  const who =
    users != null
      ? `${users} known user(s); ${unidentified ?? "unknown"} unidentified hits`
      : "unknown; check PostHog counts";
  const count = alert?.count ?? "multiple";
  return {
    whatWrongOrWanted: plainProblem(alert?.message),
    whoItAffects: who,
    recommendedCourseAndWhy: `Investigate and fix the root cause. Why: ${count} production hit(s).`,
    whatValentinMustDecide: "nothing; a runner will investigate",
    howToUndo: "close or move to Done when fixed",
  };
}

export function plainLanguageIncidentTitle(alert) {
  if (typeof alert?.incident_title === "string" && alert.incident_title.trim()) {
    return alert.incident_title.trim().slice(0, 99);
  }
  const page = plainPageName(alert?.url);
  const problem = plainProblem(alert?.message);
  const where = page === "the app" ? "" : ` on ${page}`;
  return `${problem}${where}`.slice(0, 99);
}

export const INTERNAL_AGENT_TICKET_BOARDS = new Set([15, 4060]);

export function isInternalAgentTicketBoard(projectId) {
  return INTERNAL_AGENT_TICKET_BOARDS.has(projectId);
}

export function plainLanguageTicketWriterRule() {
  return `Use docs/ticket-template.md on every board. Open with exactly these five labelled paragraphs in order: ${PLAIN_LANGUAGE_TICKET_LABELS.map((label) => `${label}:`).join("; ")}. Give each a nonempty plain value. Use at most twelve words per sentence, excluding the label. Keep status, code, paths, ids, repro commands and raw source text below the first <hr>. Preserve those details there. This opening replaces default or board-specific Now/Problem/Fix/Done when/Risk/Decision sections. Keep the title plain. The decision is a yes/no question or nothing.`;
}
