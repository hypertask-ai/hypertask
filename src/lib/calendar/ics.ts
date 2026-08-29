// Pure iCalendar (RFC 5545) builders for the read-only task feed (HTPR-4288).
// No dependencies, no I/O — everything here is unit-testable in isolation.

export interface IcsTask {
  id: number;
  uniqueIndex: number;
  ticketNumber: string | null;
  title: string;
  section: string;
  projectId: number;
  dueDate: Date;
}

const CRLF = "\r\n";

/** Escape a TEXT value per RFC 5545 §3.3.11 (order matters: backslash first). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Fold a content line to <=75 octets per RFC 5545 §3.1, splitting on UTF-8 byte
 * boundaries (never mid-codepoint). Continuation lines start with a single space.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75; // first line gets 75, continuations get 74 (leading space counts)
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off so we don't cut a multi-byte codepoint (continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    const chunk = bytes.subarray(start, end).toString("utf8");
    out.push(out.length === 0 ? chunk : ` ${chunk}`);
    start = end;
    limit = 74;
  }
  return out.join(CRLF);
}

/** UTC timestamp form YYYYMMDDTHHMMSSZ. */
export function formatUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Date-only form YYYYMMDD (UTC). */
export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** True when the stored instant is exactly UTC midnight (a date without a time). */
export function isMidnightUtc(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function taskUrl(task: IcsTask): string {
  return `https://app.hypertask.ai/detail/project-${task.projectId}/${task.uniqueIndex}`;
}

/** Build the VEVENT content lines (unfolded) for one task. */
export function buildEvent(task: IcsTask, dtstamp: Date): string[] {
  const url = taskUrl(task);
  const summary = [task.ticketNumber, task.title].filter(Boolean).join(" ").trim();
  const lines = [
    "BEGIN:VEVENT",
    `UID:task-${task.id}@hypertask.ai`,
    `DTSTAMP:${formatUtcStamp(dtstamp)}`,
  ];

  if (isMidnightUtc(task.dueDate)) {
    const end = new Date(task.dueDate.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${formatUtcDate(task.dueDate)}`);
    lines.push(`DTEND;VALUE=DATE:${formatUtcDate(end)}`);
  } else {
    const end = new Date(task.dueDate.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatUtcStamp(task.dueDate)}`);
    lines.push(`DTEND:${formatUtcStamp(end)}`);
  }

  lines.push(`SUMMARY:${escapeText(summary)}`);
  lines.push(`URL:${escapeText(url)}`);
  lines.push(`DESCRIPTION:${escapeText(`${task.section}\n${url}`)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** Build the full VCALENDAR document (folded, CRLF-terminated). */
export function buildCalendar(tasks: IcsTask[], now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hypertask//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Hypertask Tasks",
  ];
  for (const task of tasks) lines.push(...buildEvent(task, now));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
