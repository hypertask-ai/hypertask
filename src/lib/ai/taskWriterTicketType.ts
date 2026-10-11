// HTPR-7123: the Task Writer states the ticket type in a hidden span, the server validates it,
// and Ctrl+J compose uses it to pick the board column. Nothing else from the model picks a column.
export const TICKET_TYPE_MARKER_ID = "ai-generated-task-type";
export const TICKET_TYPE_HEADER = "X-Task-Writer-Ticket-Type";

export type TaskWriterTicketType = "bug" | "improvement" | "feature";

// Opening tag of a marker span: quoted or unquoted id, optionally self-closing.
const OPEN_RE = new RegExp(`<span\\b[^>]*?\\bid\\s*=\\s*(?:"${TICKET_TYPE_MARKER_ID}"|'${TICKET_TYPE_MARKER_ID}'|${TICKET_TYPE_MARKER_ID}(?=[\\s/>]))[^>]*>`, "i");
const SPAN_TAG_RE = /<(\/?)span\b[^>]*>/gi;

export function parseTicketType(value: unknown): TaskWriterTicketType | null {
  if (typeof value !== "string") return null;
  let text = value;
  for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(/<[^>]*>/g, ""); }
  text = text.trim().toLowerCase();
  return text === "bug" || text === "improvement" || text === "feature" ? text : null;
}

/** Reads the first marker, removes every marker (nested spans and self-closing tags included). */
export function readTaskWriterTicketType(html: string): { type: TaskWriterTicketType | null; html: string } {
  let type: TaskWriterTicketType | null = null;
  let first = true;
  let rest = html;
  let out = "";
  for (;;) {
    const open = OPEN_RE.exec(rest);
    if (!open) break;
    out += rest.slice(0, open.index);
    const afterOpen = rest.slice(open.index + open[0].length);
    let inner = "";
    let consumed = 0;
    if (!/\/\s*>$/.test(open[0])) {
      let depth = 1;
      SPAN_TAG_RE.lastIndex = 0;
      let tag: RegExpExecArray | null;
      while ((tag = SPAN_TAG_RE.exec(afterOpen))) {
        depth += tag[1] ? -1 : /\/\s*>$/.test(tag[0]) ? 0 : 1;
        if (depth === 0) { inner = afterOpen.slice(0, tag.index); consumed = tag.index + tag[0].length; break; }
      }
      // An unclosed marker removes only its own opening tag, never the text after it.
    }
    if (first) type = parseTicketType(inner);
    first = false;
    rest = afterOpen.slice(consumed);
  }
  return { type, html: out + rest };
}

/** Server side: keep one canonical marker when the model gave a valid type, otherwise none. */
export function normalizeTaskWriterTicketType(html: string): string {
  const { type, html: stripped } = readTaskWriterTicketType(html);
  return type ? `${stripped}<span id="${TICKET_TYPE_MARKER_ID}" style="display:none">${type}</span>` : stripped;
}

const HOLD_BACK_MAX = 240;

/**
 * How much of a streaming buffer is safe to send now. The trailing marker span (or a possible start of
 * one) stays in the buffer so the server can validate it; everything before it streams as usual.
 */
export function ticketTypeSafeCut(buffer: string): number {
  const start = buffer.indexOf("<span", Math.max(0, buffer.length - HOLD_BACK_MAX));
  if (start >= 0) return start;
  for (let keep = Math.min(4, buffer.length); keep > 0; keep--) {
    if ("<span".startsWith(buffer.slice(buffer.length - keep))) return buffer.length - keep;
  }
  return buffer.length;
}

const TYPE_TITLES: Record<TaskWriterTicketType, string[]> = {
  bug: ["bugs", "bug"],
  improvement: ["improvements", "improvement"],
  feature: ["features", "feature"],
};

type SectionLike = { section_title: string; id?: number; sectionId?: number; deleted?: boolean | null; visibility?: boolean };

/** The board column whose title matches the type, case-insensitive, or null when the board has none. */
export function ticketTypeSection(
  type: TaskWriterTicketType | null | undefined,
  sections: SectionLike[] | undefined,
): { id: number; title: string } | null {
  if (!type) return null;
  const titles = TYPE_TITLES[type];
  for (const section of sections ?? []) {
    const id = section.id ?? section.sectionId;
    if (section.deleted || section.visibility === false || typeof id !== "number") continue;
    if (titles.includes(section.section_title.trim().toLowerCase())) return { id, title: section.section_title };
  }
  return null;
}

/** True when the column the board would use by default is the Bugs column. */
export function isBugsColumn(
  defaults: { sectionId?: number; section?: string } | undefined,
  sections: SectionLike[] | undefined,
): boolean {
  const byId = (sections ?? []).find((section) => (section.id ?? section.sectionId) === defaults?.sectionId);
  const title = (byId?.section_title ?? defaults?.section ?? "").trim().toLowerCase();
  return TYPE_TITLES.bug.includes(title);
}
