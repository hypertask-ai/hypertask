export function searchTaskDescription(
  task: { description?: string | null; description_?: { content?: string | null } | null },
  full: boolean,
): string {
  if (!full) return task.description ?? ""
  return task.description_?.content || task.description || ""
}
