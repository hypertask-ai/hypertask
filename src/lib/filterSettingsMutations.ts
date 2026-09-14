import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import type {
  IFilter,
  IFilterSettings,
  IValuePropUpdatedAt,
  TFilter,
  TMatchFilters,
} from "@/models/Filters/model";
import type {
  MyTasksDateRange,
  MyTasksDueDatePreset,
  MyTasksViewConfig,
} from "@/models/MyTasksView";
import { defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";

/** Serializable board/My Tasks filter settings (no condition functions). */
export type SerializableFilterSettings = {
  matchFilters: TMatchFilters;
  addedFilters: Array<{
    type: TFilter;
    searchPayload: unknown[];
    match?: TMatchFilters;
  }>;
};

const cloneSettings = (
  settings: SerializableFilterSettings | IFilterSettings,
): SerializableFilterSettings => ({
  matchFilters: settings.matchFilters === "ALL" ? "ALL" : "ANY",
  addedFilters: (settings.addedFilters ?? []).map((filter) => ({
    type: filter.type,
    searchPayload: Array.isArray(filter.searchPayload)
      ? [...filter.searchPayload]
      : [],
    ...(filter.match === "ALL" || filter.match === "ANY"
      ? { match: filter.match }
      : {}),
  })),
});

export const emptyFilterSettings = (): SerializableFilterSettings =>
  cloneSettings(defaultFilterSettings);

const payloadId = (value: { id?: unknown } | null | undefined) => value?.id;

export function addFilterValue(
  settings: SerializableFilterSettings,
  type: TFilter,
  value: { id?: unknown },
): SerializableFilterSettings {
  const next = cloneSettings(settings);
  const index = next.addedFilters.findIndex((filter) => filter.type === type);
  if (index === -1) {
    next.addedFilters.push({ type, searchPayload: [value] });
    return next;
  }
  const existing = next.addedFilters[index];
  const already = existing.searchPayload.some(
    (item) => payloadId(item as { id?: unknown }) === payloadId(value),
  );
  if (already) {
    existing.searchPayload = existing.searchPayload.filter(
      (item) => payloadId(item as { id?: unknown }) !== payloadId(value),
    );
    if (existing.searchPayload.length === 0) {
      next.addedFilters.splice(index, 1);
    }
  } else {
    existing.searchPayload.push(value);
  }
  return next;
}

export function overrideFilterValue(
  settings: SerializableFilterSettings,
  type: TFilter,
  value: unknown,
): SerializableFilterSettings {
  const next = cloneSettings(settings);
  const index = next.addedFilters.findIndex((filter) => filter.type === type);
  if (index === -1) {
    next.addedFilters.push({ type, searchPayload: [value] });
  } else {
    next.addedFilters[index].searchPayload = [value];
  }
  return next;
}

export function removeFilterType(
  settings: SerializableFilterSettings,
  type: TFilter,
): SerializableFilterSettings {
  const next = cloneSettings(settings);
  next.addedFilters = next.addedFilters.filter((filter) => filter.type !== type);
  return next;
}

export function toggleMatchFilters(
  settings: SerializableFilterSettings,
): SerializableFilterSettings {
  const next = cloneSettings(settings);
  next.matchFilters = next.matchFilters === "ALL" ? "ANY" : "ALL";
  return next;
}

export function toggleFilterValueMatchMode(
  settings: SerializableFilterSettings,
  type: TFilter,
  nextMatch?: TMatchFilters,
): SerializableFilterSettings {
  const next = cloneSettings(settings);
  const existing = next.addedFilters.find((filter) => filter.type === type);
  if (!existing?.searchPayload?.length) return next;
  existing.match =
    nextMatch ?? (existing.match === "ALL" ? "ANY" : "ALL");
  return next;
}

export function resetFilterSettings(): SerializableFilterSettings {
  return emptyFilterSettings();
}

export function toIFilterSettings(
  settings: SerializableFilterSettings | null | undefined,
): IFilterSettings {
  if (!settings) return { matchFilters: "ANY", addedFilters: [] };
  return {
    matchFilters: settings.matchFilters === "ALL" ? "ALL" : "ANY",
    addedFilters: settings.addedFilters.map(
      (filter) =>
        ({
          type: filter.type,
          searchPayload: filter.searchPayload,
          match: filter.match,
        }) as IFilter,
    ),
  };
}

const DUE_PRESET_TO_DYNAMIC: Record<
  MyTasksDueDatePreset,
  NonNullable<IValuePropUpdatedAt["dynamicRange"]>
> = {
  overdue: "OVERDUE",
  today: "TODAY",
  this_week: "THIS_WEEK",
  next_7_days: "NEXT_7_DAYS",
  no_due_date: "NO_DUE_DATE",
};

const dateRangePayload = (range: MyTasksDateRange): IValuePropUpdatedAt => ({
  selectedDate: null,
  fromDate: range.from,
  toDate: range.to,
  condition: null,
  dynamicRange: null,
});

const dynamicDatePayload = (
  dynamicRange: NonNullable<IValuePropUpdatedAt["dynamicRange"]>,
): IValuePropUpdatedAt => ({
  selectedDate: null,
  fromDate: null,
  toDate: null,
  condition: null,
  dynamicRange,
});

/** Flat fields that Kanban filterSettings can represent (starred:false cannot). */
export function hasMigratableFlatFilters(
  filters: MyTasksViewConfig["filters"],
): boolean {
  return (
    filters.priorityIds.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.sizeIds.length > 0 ||
    filters.starred === true ||
    filters.dueDate !== null ||
    filters.createdRange !== null ||
    filters.updatedRange !== null
  );
}

/**
 * Move overlapping flat My Tasks filters into Kanban filterSettings.
 * Leaves board/column/showDone flat. Keeps starred:false flat (Kanban Starred
 * only means "is starred"). Flat values win when the same type already exists
 * so flag-off legacy edits are not discarded when parity turns back on.
 */
export function migrateFlatFiltersToFilterSettings(
  config: MyTasksViewConfig,
  labelNames?: ReadonlyMap<string, string>,
): MyTasksViewConfig {
  if (!hasMigratableFlatFilters(config.filters)) return config;

  const { filters } = config;
  const existing = cloneSettings(
    config.filterSettings ?? emptyFilterSettings(),
  );
  let addedFilters = [...existing.addedFilters];
  const upsert = (
    type: TFilter,
    entry: SerializableFilterSettings["addedFilters"][number],
  ) => {
    addedFilters = [
      ...addedFilters.filter((filter) => filter.type !== type),
      entry,
    ];
  };

  if (filters.priorityIds.length > 0) {
    const ids = new Set(filters.priorityIds);
    upsert("Priority", {
      type: "Priority",
      searchPayload: PriorityConstants.filter((p) =>
        ids.has(p.priority_index),
      ),
    });
  }
  if (filters.labelIds.length > 0) {
    upsert("Labels", {
      type: "Labels",
      searchPayload: filters.labelIds.map((id) => {
        const key = String(id);
        const value = labelNames?.get(key);
        return value ? { id: key, value } : { id: key };
      }),
    });
  }
  if (filters.sizeIds.length > 0) {
    const ids = new Set(filters.sizeIds);
    upsert("Size", {
      type: "Size",
      searchPayload: EstimateConstants.filter((e) =>
        ids.has(e.estimate_index),
      ),
    });
  }
  if (filters.starred === true) {
    upsert("Starred", { type: "Starred", searchPayload: [{ id: 0 }] });
  }
  if (filters.dueDate !== null) {
    upsert("DueDate", {
      type: "DueDate",
      searchPayload: [
        typeof filters.dueDate === "string"
          ? dynamicDatePayload(DUE_PRESET_TO_DYNAMIC[filters.dueDate])
          : dateRangePayload(filters.dueDate),
      ],
    });
  }
  if (filters.createdRange) {
    upsert("CreatedAt", {
      type: "CreatedAt",
      searchPayload: [dateRangePayload(filters.createdRange)],
    });
  }
  if (filters.updatedRange) {
    upsert("UpdatedRange", {
      type: "UpdatedRange",
      searchPayload: [dateRangePayload(filters.updatedRange)],
    });
  }

  return {
    ...config,
    filters: {
      ...filters,
      priorityIds: [],
      labelIds: [],
      sizeIds: [],
      // Keep "not starred" in flat filters; Kanban Starred cannot express it.
      starred: filters.starred === false ? false : null,
      dueDate: null,
      createdRange: null,
      updatedRange: null,
    },
    filterSettings: {
      matchFilters: existing.matchFilters === "ALL" ? "ALL" : "ANY",
      addedFilters,
    },
  };
}

/** Count on the parity Filters button: settings entries plus leftover not-starred. */
export function myTasksParityFilterCount(config: MyTasksViewConfig): number {
  const migrated = migrateFlatFiltersToFilterSettings(config);
  const settingsCount = migrated.filterSettings?.addedFilters?.length ?? 0;
  const notStarred =
    migrated.filters.starred === false || config.filters.starred === false
      ? 1
      : 0;
  return settingsCount + notStarred;
}
