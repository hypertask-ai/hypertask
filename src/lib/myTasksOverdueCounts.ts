import {
  overdueCountForMyTasksTasks,
  type ApplyMyTasksViewOptions,
  type MyTasksTask,
} from "@/lib/myTasksFiltering";
import {
  taskMatchesMyTasksScopes,
  type MyTasksScopeMembership,
  type MyTasksViewOverdueCounts,
} from "@/lib/myTasksOverdueCountUtils";
import {
  DEFAULT_MY_TASKS_SCOPES,
  effectiveMyTasksScopes,
} from "@/lib/myTasksScopes";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
  type MyTasksSavedView,
  type MyTasksViewConfig,
} from "@/models/MyTasksView";

export type {
  MyTasksScopeMembership,
  MyTasksViewOverdueCounts,
} from "@/lib/myTasksOverdueCountUtils";
export {
  EMPTY_MY_TASKS_VIEW_OVERDUE_COUNTS,
  mergeActiveViewOverdueCounts,
  msUntilNextLocalMidnight,
  parseMyTasksViewOverdueCounts,
  taskMatchesMyTasksScopes,
} from "@/lib/myTasksOverdueCountUtils";

export function overdueCountForScopedMyTasksView(
  tasks: MyTasksTask[],
  rawConfig: MyTasksViewConfig,
  membership: MyTasksScopeMembership,
  now: Date,
  options: ApplyMyTasksViewOptions,
  scopesEnabled: boolean,
): number {
  const config = parseMyTasksViewConfig(rawConfig);
  const scopes = effectiveMyTasksScopes(
    config.scopes ?? DEFAULT_MY_TASKS_SCOPES,
    scopesEnabled,
  );
  const scoped = tasks.filter((task) =>
    taskMatchesMyTasksScopes(task, scopes, membership),
  );
  return overdueCountForMyTasksTasks(scoped, config, now, options);
}

export function overdueCountsFromAuthorizedTasks(
  tasks: MyTasksTask[],
  views: MyTasksSavedView[],
  membership: MyTasksScopeMembership,
  now: Date,
  options: ApplyMyTasksViewOptions,
  scopesEnabled: boolean,
): MyTasksViewOverdueCounts {
  const byViewId: Record<number, number> = {};
  for (const view of views) {
    byViewId[view.id] = overdueCountForScopedMyTasksView(
      tasks,
      view.config,
      membership,
      now,
      options,
      scopesEnabled,
    );
  }
  return {
    all: overdueCountForScopedMyTasksView(
      tasks,
      DEFAULT_MY_TASKS_VIEW_CONFIG,
      membership,
      now,
      options,
      scopesEnabled,
    ),
    byViewId,
  };
}
