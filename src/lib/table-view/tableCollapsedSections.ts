import type { IProject } from "@/models/model";

export function parseTableCollapsedSections(value: unknown): Set<string> {
  if (typeof value !== "string" || !value.trim()) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    );
  } catch {
    return new Set();
  }
}

export function serializeTableCollapsedSections(collapsed: Set<string>): string | null {
  if (collapsed.size === 0) return null;
  return JSON.stringify([...collapsed].sort());
}

export function sanitizeTableCollapsedSectionsForWrite(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const parsed = parseTableCollapsedSections(value);
    return serializeTableCollapsedSections(parsed);
  }
  if (Array.isArray(value)) {
    const keys = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    return serializeTableCollapsedSections(new Set(keys));
  }
  return null;
}

export function getActiveTableCollapsedSectionsFromProject(project?: IProject | null): Set<string> {
  const view = project?.project_view?.user_project_views?.[0];
  const activeView =
    view?.unsavedView ?? view?.appliedView ?? project?.project_view?.default_view;
  return parseTableCollapsedSections(activeView?.table_collapsed_sections);
}

export const tableTaskRowKey = (taskId: number, sid: string | number) => `${taskId}:${sid}`;
