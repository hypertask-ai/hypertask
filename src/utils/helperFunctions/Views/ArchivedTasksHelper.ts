import type { IFilterRuntimeContext } from "@/models/Filters/model";
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

export const getViewAppliedArchivedTasks = (
  archivedTasks: ITask[] | undefined,
  sectionId: number | undefined,
  project?: IProject | null,
  runtimeContext?: IFilterRuntimeContext,
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
      runtimeContext,
    )[0]?.items ?? [];

  if (getActiveSortingModeFromProject(project) === "Manual") {
    return [...filtered].sort(byMostRecentlyArchived);
  }
  return returnSortedItems([...filtered], project);
};
