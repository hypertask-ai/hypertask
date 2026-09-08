import type { ISection } from "@/models/model";
import type { IPrioritiesConstants } from "@/lib/constants/constants";
import { priorityFilterCondition } from "@/utils/helperFunctions/Views/FilterHelperFunctions";

/**
 * Pure, board-agnostic filtering for the My Tasks page (HTPR-6312).
 *
 * My Tasks spans every board, so it cannot reuse the project-scoped filter
 * system (FilterHTC/useFilters bail out without a current project and persist
 * to one board's saved view). This keeps its own selection in component state
 * only and reuses the shared per-type condition functions here. An empty
 * selection means "no filter".
 */
export function filterMyTasksByPriority(
  sections: ISection[],
  selected: IPrioritiesConstants[],
): ISection[] {
  if (selected.length === 0) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => priorityFilterCondition(item, selected)),
  }));
}
