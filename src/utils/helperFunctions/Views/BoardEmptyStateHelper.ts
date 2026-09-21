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

/**
 * Detects the root cause of an empty board state
 * 
 * Checks multiple scenarios:
 * 1. No columns exist at all
 * 2. All columns are hidden via visibility settings
 * 3. Filters are hiding all tasks
 * 4. Empty sections are hidden and all sections happen to be empty
 * 5. Board is actually empty (no tasks exist)
 */
export function detectEmptyBoardState(
  originalSections: ISection[],
  filteredSections: ISection[],
  project: IProject
): EmptyStateDetection {
  // Get all columns (including hidden ones)
  const allColumns = getActiveColumnsViewFromProject(project);
  const visibleColumns = allColumns.filter((col) => col.visibility);
  
  // Count tasks in original vs filtered sections
  const originalTaskCount = originalSections.reduce(
    (sum, section) => sum + (section.items?.length ?? 0),
    0
  );
  const filteredTaskCount = filteredSections.reduce(
    (sum, section) => sum + (section.items?.length ?? 0),
    0
  );
  
  // Check filter settings
  const filterSettings = getActiveFiltersFromProject(project);
  const hasActiveFilters =
    filterSettings.addedFilters && filterSettings.addedFilters.length > 0;
  
  // Check empty sections setting
  const emptySectionsSetting = getActiveEmptySectionSettingFromProject(project);
  const emptySectionsHidden = emptySectionsSetting === "Hidden";
  
  // Check if all original sections are empty
  const allSectionsEmpty = originalSections.every(
    (section) => (section.items?.length ?? 0) === 0
  );
  
  // Detection logic (order matters - check most specific first)
  
  // 1. No columns exist at all
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
  
  // 2. All columns are hidden
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
  
  // 3. Filters are hiding all tasks (tasks exist but filters match nothing)
  // Check this BEFORE empty sections check, because filters can hide tasks
  // even when empty sections are hidden
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
  
  // 4. Empty sections hidden + all sections are empty
  // Only check if no filters are active (filters already handled above)
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
  
  // 5. Actually empty (no tasks exist)
  // Only check if no filters are active and columns are visible
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
  
  // Fallback (shouldn't happen if board is truly empty)
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
