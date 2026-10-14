import { IProject, ISection } from "@/models/model";
import { getActiveColumnsViewFromProject } from "./ViewsHelperFunctions";
import { getActiveFiltersFromProject } from "./ViewsHelperFunctions";
import { getActiveEmptySectionSettingFromProject } from "./ViewsHelperFunctions";

export type EmptyStateCause =
  | "no_columns"
  | "all_columns_hidden"
  | "filters_hiding_all"
  | "empty_sections_hidden"
  | "actually_empty";

export interface EmptyStateDetection {
  cause: EmptyStateCause;
  hasColumns: boolean;
  hasVisibleColumns: boolean;
  hasTasks: boolean;
  hasFilteredTasks: boolean;
  hasActiveFilters: boolean;
  emptySectionsHidden: boolean;
}

export function detectEmptyBoardState(
  originalSections: ISection[],
  filteredSections: ISection[],
  project: IProject
): EmptyStateDetection {
  const allColumns = getActiveColumnsViewFromProject(project);
  const visibleColumns = allColumns.filter((col) => col.visibility);
  
  const originalTaskCount = originalSections.reduce(
    (sum, section) => sum + (section.items?.length ?? 0),
    0
  );
  const filteredTaskCount = filteredSections.reduce(
    (sum, section) => sum + (section.items?.length ?? 0),
    0
  );
  
  const filterSettings = getActiveFiltersFromProject(project);
  const hasActiveFilters =
    filterSettings.addedFilters && filterSettings.addedFilters.length > 0;
  
  const emptySectionsSetting = getActiveEmptySectionSettingFromProject(project);
  const emptySectionsHidden = emptySectionsSetting === "Hidden";
  
  const allSectionsEmpty = originalSections.every(
    (section) => (section.items?.length ?? 0) === 0
  );
  
  
  if (!allColumns || allColumns.length === 0) {
    return {
      cause: "no_columns",
      hasColumns: false,
      hasVisibleColumns: false,
      hasTasks: originalTaskCount > 0,
      hasFilteredTasks: filteredTaskCount > 0,
      hasActiveFilters,
      emptySectionsHidden,
    };
  }
  
  if (visibleColumns.length === 0 && allColumns.length > 0) {
    return {
      cause: "all_columns_hidden",
      hasColumns: true,
      hasVisibleColumns: false,
      hasTasks: originalTaskCount > 0,
      hasFilteredTasks: filteredTaskCount > 0,
      hasActiveFilters,
      emptySectionsHidden,
    };
  }
  
  if (
    hasActiveFilters &&
    originalTaskCount > 0 &&
    filteredTaskCount === 0 &&
    visibleColumns.length > 0
  ) {
    return {
      cause: "filters_hiding_all",
      hasColumns: true,
      hasVisibleColumns: true,
      hasTasks: true,
      hasFilteredTasks: false,
      hasActiveFilters: true,
      emptySectionsHidden,
    };
  }
  
  if (
    emptySectionsHidden &&
    allSectionsEmpty &&
    visibleColumns.length > 0 &&
    !hasActiveFilters
  ) {
    return {
      cause: "empty_sections_hidden",
      hasColumns: true,
      hasVisibleColumns: true,
      hasTasks: false,
      hasFilteredTasks: false,
      hasActiveFilters: false,
      emptySectionsHidden: true,
    };
  }
  
  if (
    originalTaskCount === 0 &&
    visibleColumns.length > 0 &&
    !hasActiveFilters
  ) {
    return {
      cause: "actually_empty",
      hasColumns: true,
      hasVisibleColumns: true,
      hasTasks: false,
      hasFilteredTasks: false,
      hasActiveFilters: false,
      emptySectionsHidden,
    };
  }
  
  return {
    cause: "actually_empty",
    hasColumns: allColumns.length > 0,
    hasVisibleColumns: visibleColumns.length > 0,
    hasTasks: originalTaskCount > 0,
    hasFilteredTasks: filteredTaskCount > 0,
    hasActiveFilters,
    emptySectionsHidden,
  };
}
