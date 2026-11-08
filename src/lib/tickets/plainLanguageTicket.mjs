import { plainPageName, plainProblem } from "../errors/plainIncident.mjs";

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

function structuredText(html) {
  return html
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
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
  constructor(missing) {
    super(plainLanguageTicketRefusalMessage(missing));
    this.missing = missing;
  }
}

export function assertPlainLanguageTicketBlock(html) {
  if (!hasPlainLanguageTicketBlock(html ?? "")) {
    throw new PlainLanguageTicketError(missingPlainLanguageTicketLabels(html ?? ""));
  }
}

export function hasPlainLanguageTicketBlock(html) {
  if (typeof html !== "string" || !html.trim()) return false;
  const source = structuredText(html);
  const trimmed = source.trimStart();
  const opener = openingLabelPattern(PLAIN_LANGUAGE_TICKET_LABELS[0]);
  const atStart = trimmed.match(opener);
  if (!atStart || atStart.index !== 0) return false;
  return PLAIN_LANGUAGE_TICKET_LABELS.every((label) => labelPattern(label).test(source));
}

export function missingPlainLanguageTicketLabels(html) {
  if (typeof html !== "string" || !html.trim()) return [...PLAIN_LANGUAGE_TICKET_LABELS];
  const source = structuredText(html);
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

export const INTERNAL_AGENT_TICKET_BOARDS = new Set([15, 11514]);

export function isInternalAgentTicketBoard(projectId) {
  return INTERNAL_AGENT_TICKET_BOARDS.has(projectId);
}
