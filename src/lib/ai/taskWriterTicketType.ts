// HTPR-7123: the Task Writer states the ticket type in a hidden span, the server validates it,
// and Ctrl+J compose uses it to pick the board column. Nothing else from the model picks a column.
export const TICKET_TYPE_MARKER_ID = "ai-generated-task-type";
export const TICKET_TYPE_HEADER = "X-Task-Writer-Ticket-Type";

export type TaskWriterTicketType = "bug" | "improvement" | "feature";

const MARKER_RE = new RegExp(`<span\\b[^>]*\\bid=["']${TICKET_TYPE_MARKER_ID}["'][^>]*>([\\s\\S]*?)<\\/span>`, "gi");

export function parseTicketType(value: unknown): TaskWriterTicketType | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/<[^>]*>/g, "").trim().toLowerCase();
  return text === "bug" || text === "improvement" || text === "feature" ? text : null;
}

/** Reads the first marker, removes every marker, and returns the html without them. */
export function readTaskWriterTicketType(html: string): { type: TaskWriterTicketType | null; html: string } {
  let type: TaskWriterTicketType | null = null;
  let first = true;
  const stripped = html.replace(MARKER_RE, (_match, inner: string) => {
    if (first) type = parseTicketType(inner);
    first = false;
    return "";
  });
  return { type, html: stripped };
}

/** Server side: keep one canonical marker when the model gave a valid type, otherwise none. */
export function normalizeTaskWriterTicketType(html: string): string {
  const { type, html: stripped } = readTaskWriterTicketType(html);
  return type ? `${stripped}<span id="${TICKET_TYPE_MARKER_ID}" style="display:none">${type}</span>` : stripped;
}

const TYPE_TITLES: Record<TaskWriterTicketType, string[]> = {
  bug: ["bugs", "bug"],
  improvement: ["improvements", "improvement"],
  feature: ["features", "feature"],
};

/** The board column whose title matches the type, case-insensitive, or null when the board has none. */
export function ticketTypeSection(
  type: TaskWriterTicketType | null | undefined,
  sections: { section_title: string; id?: number; sectionId?: number; deleted?: boolean | null }[] | undefined,
): { id: number; title: string } | null {
  if (!type) return null;
  const titles = TYPE_TITLES[type];
  for (const section of sections ?? []) {
    const id = section.id ?? section.sectionId;
    if (section.deleted || typeof id !== "number") continue;
    if (titles.includes(section.section_title.trim().toLowerCase())) return { id, title: section.section_title };
  }
  return null;
}
