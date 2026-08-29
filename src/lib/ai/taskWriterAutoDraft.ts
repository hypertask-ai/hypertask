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
  tags?: TaskWriterTag[] | null;
  priority?: TaskWriterPriority;
  estimate?: TaskWriterEstimate;
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

  if (title) contextLines.push(`Title: ${title}`);
  if (tags.length) contextLines.push(`Tags: ${tags.join(", ")}`);
  if (priority) contextLines.push(`Priority: ${priority}`);
  if (estimate) contextLines.push(`Size: ${estimate}`);

  const instruction =
    "Draft this task now from the ticket's existing content. Treat the user's wording as source material, and preserve specific repro steps, requirements, and decisions.";

  return contextLines.length
    ? `${instruction}\n\nCurrent ticket:\n${contextLines
        .map((line) => `- ${line}`)
        .join("\n")}`
    : instruction;
}
