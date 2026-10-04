export function isEmptyComposeTarget(task: {
  title?: string | null;
  description?: string | null;
  description_?: { content?: string | null } | null;
}): boolean {
  const title = task.title?.trim().toLowerCase() ?? "";
  const description = task.description_?.content ?? task.description ?? "";
  return ["", "enter task title here", "new task"].includes(title) &&
    !/<(?:img|video|audio|iframe|embed|hr)\b/i.test(description) &&
    !description.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
}
