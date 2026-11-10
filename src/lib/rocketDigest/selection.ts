import type { ShippedTicket, TicketKind } from "./entries";

export const DIGEST_PROJECT_ID = 15;
export const RELEASE_SECTION_TITLES = ["Flag: Everyone", "No Flag"];
export const ALARM_PROJECT_ID = 11514;
export const ALARM_SECTION_TITLE = "Backlog";
export const ALARM_LABEL_VALUES = ["CI", "Hypertask CI"];
export const ALARM_PRIORITY_INDEX = 1;

const INTERNAL_LABELS = new Set([
  "agent",
  "agents",
  "agent-fleet",
  "auto-error",
  "build",
  "ci",
  "infra",
  "qa ✅",
  "tooling",
]);
const INTERNAL_LABEL_PREFIXES = ["cursor ", "runner ", "runner-"];

export type ReleaseEventRow = {
  timestamp: Date;
  task: {
    uniqueIndex: number;
    title: string;
    description: string;
    section: string;
    deletedAt: Date | null;
    taskLabels: { label: { value: string | null } }[];
  };
};

export function isInternalLabel(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return (
    INTERNAL_LABELS.has(normalised) ||
    INTERNAL_LABEL_PREFIXES.some((prefix) => normalised.startsWith(prefix))
  );
}

export function ticketKind(labelValues: readonly string[]): TicketKind {
  if (labelValues.some((value) => /^bug\b/i.test(value.trim()))) return "fix";
  if (labelValues.some((value) => /^feature\b/i.test(value.trim()))) return "feature";
  return "improvement";
}

export function toShippedTickets(
  rows: readonly ReleaseEventRow[],
  releaseSections: readonly string[] = RELEASE_SECTION_TITLES,
): ShippedTicket[] {
  const released = new Map<number, ShippedTicket>();

  for (const row of rows) {
    const task = row.task;
    if (!task || task.deletedAt) continue;
    if (!releaseSections.includes(task.section)) continue;
    const labelValues = task.taskLabels
      .map((entry) => entry.label?.value ?? "")
      .filter((value): value is string => Boolean(value));
    if (labelValues.some(isInternalLabel)) continue;
    if (released.has(task.uniqueIndex)) continue;
    released.set(task.uniqueIndex, {
      uniqueIndex: task.uniqueIndex,
      title: task.title,
      description: task.description,
      releasedAt: new Date(row.timestamp),
      kind: ticketKind(labelValues),
    });
  }

  return [...released.values()].sort(
    (left, right) => left.releasedAt.getTime() - right.releasedAt.getTime(),
  );
}
