import type { IFilterRuntimeContext, IFilterSettings } from "@/models/Filters/model";
import type { IProject, ISection, IView } from "@/models/model";
import { DEFAULT_SUBTASK_SETTING, TBoardSubtaskSetting } from "@/models/Views/model";
import { applyFilters, defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { applySubTaskSetting } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getActiveSubtaskSettingFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

export const savedViewCountSections = (
  view: IView,
  project: IProject,
  visibleColumns: ISection[] | undefined,
  filterRuntimeContext: IFilterRuntimeContext,
): ISection[] => {
  const tasks = project.tasks ?? [];
  const columns =
    visibleColumns && visibleColumns.length > 0
      ? visibleColumns
      : project.section ?? [];
  const sections = columns
    .filter((column) => column.visibility !== false)
    .map((column) => {
      const sectionId = column.id ?? column.sectionId;
      return {
        ...column,
        sectionId,
        items: tasks.filter((task) => task.sectionId === sectionId),
      };
    });
  const filters = (view.board_filters as IFilterSettings | undefined) ?? defaultFilterSettings;
  return applySubTaskSetting(
    applyFilters(
      sections,
      filters.addedFilters ?? [],
      filters.matchFilters,
      project,
      filterRuntimeContext,
    ),
    subtaskSettingForCount(view, project),
  );
};

const subtaskSettingForCount = (
  view: IView,
  project: IProject,
): TBoardSubtaskSetting => {
  const stored = view.board_subtask_setting ?? DEFAULT_SUBTASK_SETTING;
  const boardDefault = project.project_view?.board_subtask_setting_for_default_view;
  if (!boardDefault || view.id !== project.project_view?.default_view_id) return stored;
  const row = project.project_view?.user_project_views?.[0];
  const onMain = !row?.appliedViewId || row.appliedViewId === project.project_view?.default_view_id;
  if (onMain) return getActiveSubtaskSettingFromProject(project);
  return boardDefault;
};

export const countTasksInSavedView = (
  view: IView,
  project: IProject,
  visibleColumns: ISection[] | undefined,
  filterRuntimeContext: IFilterRuntimeContext,
): number =>
  savedViewCountSections(view, project, visibleColumns, filterRuntimeContext).reduce(
    (count, section) => count + (section.items?.length ?? 0),
    0,
  );
