import type { CalendarTaskFilters } from "@/models/Calendar/model";

export type CalendarTaskFilterSets = {
  priority: ReadonlySet<number>;
  size: ReadonlySet<number>;
  assignees: ReadonlySet<number>;
  assigneeAgents: ReadonlySet<string>;
  updatedBy: ReadonlySet<number>;
  createdBy: ReadonlySet<number>;
  updatedByAgents: ReadonlySet<string>;
  labels: ReadonlySet<string>;
};

export const buildCalendarTaskFilterSets = (
  filters: CalendarTaskFilters,
): CalendarTaskFilterSets => ({
  priority: new Set(filters.priority),
  size: new Set(filters.size),
  assignees: new Set(filters.assignees),
  assigneeAgents: new Set(filters.assigneeAgents),
  updatedBy: new Set(filters.updatedBy),
  createdBy: new Set(filters.createdBy),
  updatedByAgents: new Set(filters.updatedByAgents),
  labels: new Set(filters.labels),
});

