const APP_ORIGIN = "https://app.hypertask.ai";
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export type RichTextMentionAttributes = {
  label?: unknown;
  dataId?: unknown;
  projectId?: unknown;
  uniqueIndex?: unknown;
};

export function buildRichTextMentionHref({
  label,
  dataId,
  projectId,
  uniqueIndex,
}: RichTextMentionAttributes): string | null {
  if (label === "task") {
    const project = String(projectId ?? "").trim();
    const index = String(uniqueIndex ?? "").trim();
    if (!POSITIVE_INTEGER.test(project) || !POSITIVE_INTEGER.test(index)) {
      return null;
    }
    return `${APP_ORIGIN}/detail/project-${project}/${index}`;
  }

  if (label === "page") {
    const id = String(dataId ?? "").trim();
    if (!id) return null;
    return `${APP_ORIGIN}/page/${encodeURIComponent(id)}`;
  }

  return null;
}
