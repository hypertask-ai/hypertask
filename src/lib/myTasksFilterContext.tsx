"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type {
  SerializableFilterSettings,
} from "@/lib/filterSettingsMutations";
import {
  addFilterValue,
  emptyFilterSettings,
  overrideFilterValue,
  removeFilterType,
  resetFilterSettings,
  toggleFilterValueMatchMode,
  toggleMatchFilters,
  toIFilterSettings,
} from "@/lib/filterSettingsMutations";
import type { IFilterSettings, TFilter, TMatchFilters } from "@/models/Filters/model";
import type { CalendarLabelSummary, CalendarUserSummary } from "@/lib/calendarSync/contract";

type MyTasksFilterContextValue = {
  settings: SerializableFilterSettings;
  activeFilters: IFilterSettings;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  addFilter: (type: TFilter, value: { id?: unknown }) => void;
  overrideFilter: (type: TFilter, value: unknown) => void;
  removeFilter: (type: TFilter) => void;
  resetFilters: () => void;
  toggleFilterMatchOptions: () => void;
  toggleFilterValueMatch: (type: TFilter, next?: TMatchFilters) => void;
};

const MyTasksFilterContext = createContext<MyTasksFilterContextValue | null>(
  null,
);

export function useMyTasksFilterController() {
  return useContext(MyTasksFilterContext);
}

type ProviderProps = {
  settings: SerializableFilterSettings | null | undefined;
  onChange: (next: SerializableFilterSettings) => void;
  members: CalendarUserSummary[];
  labels: CalendarLabelSummary[];
  children: ReactNode;
};

export function MyTasksFilterProvider({
  settings,
  onChange,
  members,
  labels,
  children,
}: ProviderProps) {
  const resolved = settings ?? emptyFilterSettings();

  const update = useCallback(
    (next: SerializableFilterSettings) => onChange(next),
    [onChange],
  );

  const value = useMemo<MyTasksFilterContextValue>(
    () => ({
      settings: resolved,
      activeFilters: toIFilterSettings(resolved),
      members,
      labels,
      addFilter: (type, value) => update(addFilterValue(resolved, type, value)),
      overrideFilter: (type, value) =>
        update(overrideFilterValue(resolved, type, value)),
      removeFilter: (type) => update(removeFilterType(resolved, type)),
      resetFilters: () => update(resetFilterSettings()),
      toggleFilterMatchOptions: () => update(toggleMatchFilters(resolved)),
      toggleFilterValueMatch: (type, next) =>
        update(toggleFilterValueMatchMode(resolved, type, next)),
    }),
    [resolved, members, labels, update],
  );

  return (
    <MyTasksFilterContext.Provider value={value}>
      {children}
    </MyTasksFilterContext.Provider>
  );
}
