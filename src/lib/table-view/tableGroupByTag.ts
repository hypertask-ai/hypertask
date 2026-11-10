import type { IProject, ISection, ITask } from "@/models/model";
import type { TableCreateTaskSection } from "@/components/PageComponents/Kanban/TableView/tableCreateTask";

export type TableGroupBy = "column" | "tag";

export type TableTagGroupedSection = TableCreateTaskSection & { items: ITask[] };

export const TABLE_GROUP_BY_TAG_NONE = "tag:none" as const;
export const NO_TAG_SECTION_TITLE = "No tag";

const TABLE_GROUP_BY_VALUES = new Set<TableGroupBy>(["column", "tag"]);

export const sanitizeTableGroupBy = (value: unknown): TableGroupBy | null =>
  typeof value === "string" && TABLE_GROUP_BY_VALUES.has(value as TableGroupBy)
    ? (value as TableGroupBy)
    : null;

export const effectiveTableGroupBy = (value: unknown): TableGroupBy =>
  sanitizeTableGroupBy(value) ?? "column";

export const getActiveTableGroupByFromProject = (
  project?: IProject | null,
): TableGroupBy => {
  const view = project?.project_view?.user_project_views?.[0];
  const activeView =
    view?.unsavedView ?? view?.appliedView ?? project?.project_view?.default_view;
  return effectiveTableGroupBy(activeView?.table_group_by);
};

export function buildTableSectionsGroupedByTag(sections: ISection[]): TableTagGroupedSection[] {
  const groups = new Map<string, { title: string; items: ITask[] }>();

  const pushTask = (key: string, title: string, task: ITask) => {
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(task);
      return;
    }
    groups.set(key, { title, items: [task] });
  };

  for (const section of sections) {
    for (const task of section.items ?? []) {
      const labels = task.taskLabels ?? [];
      if (labels.length === 0) {
        pushTask(TABLE_GROUP_BY_TAG_NONE, NO_TAG_SECTION_TITLE, task);
        continue;
      }
      const seenForTask = new Set<string>();
      for (const taskLabel of labels) {
        const labelId = taskLabel.label?.id ?? taskLabel.labelId;
        if (!labelId || seenForTask.has(labelId)) continue;
        seenForTask.add(labelId);
        const title = taskLabel.label?.value?.trim() || labelId;
        pushTask(`tag:${labelId}`, title, task);
      }
    }
  }

  const ordered = [...groups.entries()].sort(([, a], [, b]) => {
    const aNone = a.title === NO_TAG_SECTION_TITLE;
    const bNone = b.title === NO_TAG_SECTION_TITLE;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  return ordered.map(([key, group]) => ({
    section_title: group.title,
    sectionId: key,
    id: key,
    items: group.items,
  }));
}

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
  if (typeof value === "string") return serializeTableCollapsedSections(parseTableCollapsedSections(value));
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
