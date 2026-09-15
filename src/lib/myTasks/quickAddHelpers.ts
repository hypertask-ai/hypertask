import type { IFilterRuntimeContext } from "@/models/Filters/model";
import type { MyTasksScope } from "@/lib/myTasksScopes";
import {
  applyMyTasksView,
  filterMyTasksByPriority,
  sortMyTasksViewSections,
  type MyTasksTask,
} from "@/lib/myTasksFiltering";
import { groupMyTasksByTime } from "@/lib/myTasksGrouping";
import type { MyTasksListPayload } from "@/lib/myTasks/reconcileMyTasks";
import type { IPrioritiesConstants } from "@/lib/constants/constants";
import {
  parseMyTasksDefaultBoardId,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";

export const MY_TASKS_QUICK_ADD_DEFAULT_BOARD_KEY =
  "htpr-6460-my-tasks-default-board";

/** Prefer a saved default board that is still in the writable board list. */
export function resolveMyTasksQuickAddBoardId(
  defaultBoardId: unknown,
  writableBoardIds: ReadonlySet<number> | readonly number[] | undefined,
): number | null {
  const parsed = parseMyTasksDefaultBoardId(defaultBoardId);
  if (parsed === null) return null;
  // undefined = access list not loaded yet; keep the saved id for create to authorize.
  if (writableBoardIds === undefined) return parsed;
  const writable =
    writableBoardIds instanceof Set
      ? writableBoardIds
      : new Set(writableBoardIds);
  if (writable.size === 0) return null;
  return writable.has(parsed) ? parsed : null;
}

/**
 * A task created by and assigned to the current user is visible under the
 * default assigned/created scopes. Watching-only views hide it until followed.
 */
export function myTasksQuickAddLikelyVisible(
  scopes: readonly MyTasksScope[],
): boolean {
  return scopes.some(
    (scope) => scope === "assigned" || scope === "created",
  );
}

type QuickAddVisibilityOptions = {
  viewConfig: MyTasksViewConfig;
  viewsFeatureEnabled: boolean;
  filterParityEnabled: boolean;
  groupBy: string;
  activeSplit: number;
  prioritySelection: readonly IPrioritiesConstants[];
  filterEnabled: boolean;
  runtimeContext?: IFilterRuntimeContext;
};

/**
 * Same board / filter / active-tab narrowing as the My Tasks table, so a toast
 * is not suppressed when the row exists in the payload but is hidden on screen.
 */
export function myTasksQuickAddTaskVisibleInPayload(
  payload: MyTasksListPayload,
  taskId: number,
  options: QuickAddVisibilityOptions,
): boolean {
  const now = new Date();
  if (!options.viewsFeatureEnabled) {
    const priorityFiltered = filterMyTasksByPriority(
      payload.sections,
      options.filterEnabled ? [...options.prioritySelection] : [],
    );
    return priorityFiltered.some((section) =>
      (section.items ?? []).some((task) => (task as MyTasksTask).id === taskId),
    );
  }

  const selectedBoards = options.viewConfig.boardIds
    ? new Set(options.viewConfig.boardIds)
    : null;
  const availableBoards = selectedBoards
    ? payload.boards.filter((board) => selectedBoards.has(board.id))
    : payload.boards;

  if (options.groupBy === "time") {
    const flat = payload.sections
      .filter(
        (section) =>
          !selectedBoards ||
          (section.projectId !== undefined &&
            selectedBoards.has(section.projectId)),
      )
      .flatMap((section) => (section.items ?? []) as MyTasksTask[]);
    const filtered = applyMyTasksView(flat, options.viewConfig, now, {
      applyFilterSettings: options.filterParityEnabled,
      runtimeContext: options.runtimeContext,
    });
    const selectedBoardId =
      options.activeSplit === 0
        ? null
        : availableBoards[options.activeSplit - 1]?.id ?? null;
    const scoped =
      selectedBoardId === null
        ? filtered
        : filtered.filter(
            (task) => (task.project?.id ?? task.projectId) === selectedBoardId,
          );
    return scoped.some((task) => task.id === taskId);
  }

  const boardSections = payload.sections.filter(
    (section) =>
      !selectedBoards ||
      (section.projectId !== undefined && selectedBoards.has(section.projectId)),
  );
  const filteredSections = sortMyTasksViewSections(
    boardSections.map((section) => ({
      ...section,
      items: applyMyTasksView(
        (section.items ?? []) as MyTasksTask[],
        options.viewConfig,
        now,
        {
          applyFilterSettings: options.filterParityEnabled,
          runtimeContext: options.runtimeContext,
        },
      ),
    })),
    options.viewConfig,
    now,
  );
  const visibleSections =
    options.activeSplit === 0
      ? filteredSections
      : (() => {
          const active = filteredSections[options.activeSplit - 1];
          return active ? [active] : [];
        })();
  return visibleSections.some((section) =>
    (section.items ?? []).some((task) => (task as MyTasksTask).id === taskId),
  );
}
