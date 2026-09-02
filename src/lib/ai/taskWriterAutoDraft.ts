type TaskWriterTag = { value?: string | null } | null | undefined;
type TaskWriterPriority =
  | { Priority_Value?: string | null }
  | null
  | undefined;
type TaskWriterEstimate =
  | { estimate_value?: string | null; estimate_full_value?: string | null }
  | null
  | undefined;

export interface TaskWriterAutoDraftSource {
  title?: string | null;
  description?: string | null;
  board?: string | null;
  status?: { sectionTitle?: string | null } | null;
  assignees?: ({ displayName?: string | null } | null)[] | null;
  tags?: TaskWriterTag[] | null;
  priority?: TaskWriterPriority;
  estimate?: TaskWriterEstimate;
  dueDate?: Date | string | null;
  startDate?: Date | string | null;
}

const DESCRIPTION_MEDIA_RE = /<(?:audio|embed|iframe|img|object|video)\b/i;

function htmlHasContent(value: string | null | undefined) {
  if (!value) return false;
  if (DESCRIPTION_MEDIA_RE.test(value)) return true;

  return Boolean(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function resolveTaskWriterDescription(
  ...values: Array<string | null | undefined>
) {
  return values.find(htmlHasContent) ?? values.find(Boolean) ?? "";
}

export function resolveCreateTaskWriterOpening(
  seedPrompt: string | undefined,
  autoDraftPrompt: string | null,
) {
  const explicitPrompt = seedPrompt?.trim() ? seedPrompt : undefined;

  return {
    autoTrigger: !explicitPrompt && Boolean(autoDraftPrompt),
    initialPrompt: explicitPrompt ?? autoDraftPrompt ?? undefined,
  };
}

export function resolveTaskDetailWriterOpening(
  explicitAutoTrigger: boolean,
  explicitPrompt: string,
  autoDraftPrompt: string | null,
) {
  const hasExplicitPrompt = Boolean(explicitPrompt.trim());

  return {
    autoTrigger: hasExplicitPrompt
      ? explicitAutoTrigger
      : Boolean(autoDraftPrompt),
    initialPrompt: hasExplicitPrompt
      ? explicitPrompt
      : autoDraftPrompt ?? "",
  };
}

/**
 * Build the first Task Writer request for a ticket that already has content.
 * Properties add context, but only a title or description starts the request.
 */
export function buildTaskWriterAutoDraftPrompt(
  source: TaskWriterAutoDraftSource,
): string | null {
  const title = source.title?.trim().replace(/\s+/g, " ");
  if (!title && !htmlHasContent(source.description)) return null;

  const contextLines: string[] = [];
  const tags = (source.tags ?? [])
    .map((tag) => tag?.value?.trim())
    .filter((value): value is string => Boolean(value));
  const priority = source.priority?.Priority_Value?.trim();
  const estimate =
    source.estimate?.estimate_value?.trim() ||
    source.estimate?.estimate_full_value?.trim();
  const assignees = (source.assignees ?? [])
    .map((assignee) => assignee?.displayName?.trim())
    .filter((value): value is string => Boolean(value));
  const dateLabel = (value: Date | string | null | undefined) => {
    if (!value) return undefined;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  };

  if (title) contextLines.push(`Title: ${title}`);
  if (source.board?.trim()) contextLines.push(`Board: ${source.board.trim()}`);
  if (source.status?.sectionTitle?.trim())
    contextLines.push(`Section: ${source.status.sectionTitle.trim()}`);
  if (assignees.length) contextLines.push(`Assignees: ${assignees.join(", ")}`);
  if (tags.length) contextLines.push(`Tags: ${tags.join(", ")}`);
  if (priority) contextLines.push(`Priority: ${priority}`);
  if (estimate) contextLines.push(`Size: ${estimate}`);
  if (dateLabel(source.dueDate))
    contextLines.push(`Due date: ${dateLabel(source.dueDate)}`);
  if (dateLabel(source.startDate))
    contextLines.push(`Start date: ${dateLabel(source.startDate)}`);

  const instruction =
    "Draft this task now from the ticket's existing content. Treat the user's wording as source material, and preserve specific repro steps, requirements, and decisions.";

  return contextLines.length
    ? `${instruction}\n\nCurrent ticket:\n${contextLines
        .map((line) => `- ${line}`)
        .join("\n")}`
    : instruction;
}
