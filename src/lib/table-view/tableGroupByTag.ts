import type { ISection, ITask } from "@/models/model";

import type { TableCreateTaskSection, TableSectionIdentifier } from "@/components/PageComponents/Kanban/TableView/tableCreateTask";

export type TableGroupBy = "column" | "tag";

export type TableTagGroupedSection = TableCreateTaskSection & { items: ITask[] };

export const TABLE_GROUP_BY_TAG_NONE = "tag:none" as const;
export const NO_TAG_SECTION_TITLE = "No tag";

const TABLE_GROUP_BY_VALUES = new Set<TableGroupBy>(["column", "tag"]);

export const sanitizeTableGroupBy = (value: unknown): TableGroupBy | null =>
  typeof value === "string" && TABLE_GROUP_BY_VALUES.has(value as TableGroupBy)
    ? (value as TableGroupBy)
    : null;

export const tableGroupSectionId = (labelId: string) => `tag:${labelId}`;

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
        pushTask(tableGroupSectionId(labelId), title, task);
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

export function dedupeTasksForFlatTableSort(tasks: ITask[]): ITask[] {
  const seen = new Set<number>();
  const next: ITask[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    next.push(task);
  }
  return next;
}

export function sectionsUseTagGrouping(
  sections: readonly TableCreateTaskSection[],
): boolean {
  return sections.some((section) => {
    const id: TableSectionIdentifier | null | undefined = section.sectionId ?? section.id;
    return typeof id === "string" && id.startsWith("tag:");
  });
}
