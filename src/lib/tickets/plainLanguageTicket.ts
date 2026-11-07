import { parse } from "node-html-parser";

export const PLAIN_LANGUAGE_TICKET_LABELS = [
  "What's wrong or wanted",
  "Who it affects",
  "Recommended course and why",
  "What Valentin must decide",
  "How to undo",
] as const;

const TEMPLATE_DOC = "docs/ticket-template.md";

function labelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}\\s*:(?=\\s)`, "i");
}

function openingLabelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`^\\s*${escaped}\\s*:(?=\\s)`, "i");
}

function structuredText(html: string): string {
  return parse(html.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "\n")).structuredText.replace(/\s+/g, " ").trim();
}

export function hasPlainLanguageTicketBlock(html: string | null | undefined): boolean {
  if (typeof html !== "string" || !html.trim()) return false;
  const source = structuredText(html);
  const trimmed = source.trimStart();
  const opener = openingLabelPattern(PLAIN_LANGUAGE_TICKET_LABELS[0]);
  const atStart = trimmed.match(opener);
  if (!atStart || atStart.index !== 0) return false;
  return PLAIN_LANGUAGE_TICKET_LABELS.every((label) => labelPattern(label).test(source));
}

export function missingPlainLanguageTicketLabels(html: string | null | undefined): string[] {
  if (typeof html !== "string" || !html.trim()) return [...PLAIN_LANGUAGE_TICKET_LABELS];
  const source = structuredText(html);
  return PLAIN_LANGUAGE_TICKET_LABELS.filter((label) => !labelPattern(label).test(source));
}

export function plainLanguageTicketRefusalMessage(missing?: string[]): string {
  const list = (missing?.length ? missing : PLAIN_LANGUAGE_TICKET_LABELS).join(", ");
  return (
    `Ticket description must open with the plain-language block from ${TEMPLATE_DOC} ` +
    `(missing: ${list}). Put ids, paths and logs below a divider.`
  );
}

export const INTERNAL_AGENT_TICKET_BOARDS = new Set([15, 4060]);

export function isInternalAgentTicketBoard(projectId: number): boolean {
  return INTERNAL_AGENT_TICKET_BOARDS.has(projectId);
}
