import { IProject, ISection, ITask } from "@/models/model";
import { applyFilters } from "./FilterHelperFunctions";
import { returnSortedItems } from "../helperFunctions";
import {
  getActiveFiltersFromProject,
  getActiveSortingModeFromProject,
} from "./ViewsHelperFunctions";

const byMostRecentlyArchived = (a: ITask, b: ITask) =>
  new Date(b.archivedAt ?? b.updatedAt ?? 0).getTime() -
  new Date(a.archivedAt ?? a.updatedAt ?? 0).getTime();

// Archived cards used to ignore the view entirely: they were appended to the
// column filtered only by section and sorted only by archive date, so a view's
// filters and sorting silently did not apply to them (HTPR-5540).
// Takes sectionId rather than the section object on purpose: the board rebuilds
// section objects on every render, and a whole-object dependency would re-filter
// and re-sort every archived card each time.
export const getViewAppliedArchivedTasks = (
  archivedTasks: ITask[] | undefined,
  sectionId: number | undefined,
  project?: IProject | null,
): ITask[] => {
  if (!archivedTasks?.length || sectionId === undefined) return [];
  const inSection = archivedTasks.filter((task) => task.sectionId === sectionId);
  if (!inSection.length || !project) return [...inSection].sort(byMostRecentlyArchived);

  const filters = getActiveFiltersFromProject(project);
  const pseudoSection: ISection = {
    section_title: "",
    sectionId,
    items: inSection,
  };
  const filtered =
    applyFilters(
      [pseudoSection],
      filters.addedFilters ?? [],
      filters.matchFilters,
      project,
    )[0]?.items ?? [];

  // Manual order is a per-column ranking the archived cards left behind, so the
  // Manual view keeps the most-recently-archived-first order users already had.
  if (getActiveSortingModeFromProject(project) === "Manual") {
    return [...filtered].sort(byMostRecentlyArchived);
  }
  return returnSortedItems([...filtered], project);
};
