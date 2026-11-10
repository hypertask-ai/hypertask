import type { IProject, ISection, ITask, ITaskLabel } from "@/models/model";
import type { TableCreateTaskSection } from "@/components/PageComponents/Kanban/TableView/tableCreateTask";

export type TableGroupBy = "column" | "tag" | "assignee" | "priority" | "size";
export type TableGrouping = { mode: TableGroupBy; tagIds: string[]; allTags: boolean };

export type TableTagGroupedSection = TableCreateTaskSection & { items: ITask[] };

export const TABLE_GROUP_BY_TAG_NONE = "tag:none" as const;
export const NO_TAG_SECTION_TITLE = "No tag";
export const OTHER_GROUP_TITLE = "Other";
export const UNASSIGNED_GROUP_TITLE = "Unassigned";
export const NO_PRIORITY_GROUP_TITLE = "No priority";
export const NO_SIZE_GROUP_TITLE = "No size";
const TABLE_GROUP_BY_VALUES = new Set<TableGroupBy>(["column", "tag", "assignee", "priority", "size"]);
const TAG_PREFIX = "tag:";
const TAG_ID = /^[A-Za-z0-9_-]+$/;
const MAX_SELECTED_TAGS = 100;
const LAST = Number.MAX_SAFE_INTEGER;
const isTableGroupBy = (value: unknown): value is TableGroupBy =>
  typeof value === "string" && TABLE_GROUP_BY_VALUES.has(value as TableGroupBy);
const cleanTagIds = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const valid = list.filter((entry): entry is string => typeof entry === "string" && TAG_ID.test(entry));
  return [...new Set(valid)].slice(0, MAX_SELECTED_TAGS);
};

export const serializeTableGrouping = (mode: TableGroupBy, tagIds: unknown = []): string => {
  if (mode !== "tag") return mode;
  const ids = cleanTagIds(tagIds);
  return ids.length > 0 ? `${TAG_PREFIX}${ids.join(",")}` : TABLE_GROUP_BY_TAG_NONE;
};

export const sanitizeTableGrouping = (value: unknown): string | null => {
  if (isTableGroupBy(value) || value === TABLE_GROUP_BY_TAG_NONE) return value as string;
  if (typeof value !== "string" || !value.startsWith(TAG_PREFIX)) return null;
  const ids = cleanTagIds(value.slice(TAG_PREFIX.length));
  return ids.length > 0 ? `${TAG_PREFIX}${ids.join(",")}` : null;
};

export const parseTableGrouping = (value: unknown): TableGrouping => {
  const sanitized = sanitizeTableGrouping(value);
  if (!sanitized) return { mode: "column", tagIds: [], allTags: false };
  if (sanitized === "tag") return { mode: "tag", tagIds: [], allTags: true };
  if (sanitized === TABLE_GROUP_BY_TAG_NONE) return { mode: "tag", tagIds: [], allTags: false };
  if (sanitized.startsWith(TAG_PREFIX)) {
    return { mode: "tag", tagIds: cleanTagIds(sanitized.slice(TAG_PREFIX.length)), allTags: false };
  }
  return { mode: sanitized as TableGroupBy, tagIds: [], allTags: false };
};

export const sanitizeTableGroupBy = (value: unknown): TableGroupBy | null => {
  const sanitized = sanitizeTableGrouping(value);
  return sanitized ? parseTableGrouping(sanitized).mode : null;
};
export const effectiveTableGroupBy = (value: unknown): TableGroupBy =>
  sanitizeTableGroupBy(value) ?? "column";
const activeView = (project?: IProject | null) => {
  const view = project?.project_view?.user_project_views?.[0];
  return view?.unsavedView ?? view?.appliedView ?? project?.project_view?.default_view;
};
export const getActiveTableGroupingValueFromProject = (project?: IProject | null): string =>
  sanitizeTableGrouping(activeView(project)?.table_group_by) ?? "column";
export const getActiveTableGroupingFromProject = (project?: IProject | null): TableGrouping =>
  parseTableGrouping(getActiveTableGroupingValueFromProject(project));
export const getActiveTableGroupByFromProject = (project?: IProject | null): TableGroupBy =>
  getActiveTableGroupingFromProject(project).mode;
type GroupSpec = { key: string; title: string; order: number };
type Group = { title: string; order: number; items: ITask[] };
const buildGroups = (sections: ISection[], specOf: (task: ITask) => GroupSpec): TableTagGroupedSection[] => {
  const groups = new Map<string, Group>();
  for (const section of sections) {
    for (const task of section.items ?? []) {
      const spec = specOf(task);
      const group = groups.get(spec.key);
      if (group) group.items.push(task);
      else groups.set(spec.key, { title: spec.title, order: spec.order, items: [task] });
    }
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.order - b.order || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
    .map(([key, group]) => ({ section_title: group.title, sectionId: key, id: key, items: group.items }));
};

const labelId = (taskLabel: ITaskLabel) => taskLabel.label?.id ?? taskLabel.labelId;
export function buildTableSectionsGroupedByTag(
  sections: ISection[],
  selectedTagIds: string[] = [],
  allTags = false,
): TableTagGroupedSection[] {
  let selected = cleanTagIds(selectedTagIds);
  if (allTags) {
    const titles = new Map<string, string>();
    for (const section of sections) for (const task of section.items ?? []) for (const taskLabel of task.taskLabels ?? []) {
      const id = labelId(taskLabel);
      if (id && !titles.has(id)) titles.set(id, taskLabel.label?.value?.trim() || id);
    }
    selected = [...titles.keys()].sort((a, b) => (titles.get(a) ?? a).localeCompare(titles.get(b) ?? b, undefined, { sensitivity: "base" }));
  }
  return buildGroups(sections, (task) => {
    const labels = task.taskLabels ?? [];
    const index = selected.findIndex((id) => labels.some((taskLabel) => labelId(taskLabel) === id));
    if (index === -1) return { key: "tag:other", title: OTHER_GROUP_TITLE, order: LAST };
    const id = selected[index];
    const label = labels.find((taskLabel) => labelId(taskLabel) === id)?.label;
    return { key: `tag:${id}`, title: label?.value?.trim() || id, order: index };
  });
}

export function countTableTags(sections: ISection[]): { id: string; title: string; count: number }[] {
  const counts = new Map<string, { id: string; title: string; count: number }>();
  for (const section of sections) {
    for (const task of section.items ?? []) {
      const seen = new Set<string>();
      for (const taskLabel of task.taskLabels ?? []) {
        const id = labelId(taskLabel);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const existing = counts.get(id);
        if (existing) existing.count += 1;
        else counts.set(id, { id, title: taskLabel.label?.value?.trim() || id, count: 1 });
      }
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export const buildTableSectionsGroupedByAssignee = (sections: ISection[]) =>
  buildGroups(sections, (task) => {
    const assignee = task.assignees?.[0];
    if (!assignee) return { key: "assignee:none", title: UNASSIGNED_GROUP_TITLE, order: LAST };
    if (typeof assignee.agentId === "string") {
      return { key: `assignee:agent:${assignee.agentId}`, title: assignee.agent?.displayName || "Agent", order: 0 };
    }
    return { key: `assignee:user:${assignee.userId}`, title: assignee.user?.displayName || "Member", order: 0 };
  });

export const buildTableSectionsGroupedByPriority = (sections: ISection[]) =>
  buildGroups(sections, (task) => {
    const index = task.priority?.priority_index ?? 0;
    return { key: `priority:${index}`, title: task.priority?.Priority_Value?.trim() || NO_PRIORITY_GROUP_TITLE, order: index === 0 ? LAST : index };
  });

export const buildTableSectionsGroupedBySize = (sections: ISection[]) =>
  buildGroups(sections, (task) => {
    const index = task.estimate?.estimate_index ?? 0;
    return { key: `size:${index}`, title: task.estimate?.estimate_value?.trim() || NO_SIZE_GROUP_TITLE, order: index === 0 ? LAST : index };
  });
export function buildTableSectionsForGrouping(
  sections: ISection[],
  grouping: TableGrouping,
): TableTagGroupedSection[] {
  switch (grouping.mode) {
    case "assignee":
      return buildTableSectionsGroupedByAssignee(sections);
    case "priority":
      return buildTableSectionsGroupedByPriority(sections);
    case "size":
      return buildTableSectionsGroupedBySize(sections);
    case "tag":
      return buildTableSectionsGroupedByTag(sections, grouping.tagIds, grouping.allTags);
    default:
      return sections as TableTagGroupedSection[];
  }
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
