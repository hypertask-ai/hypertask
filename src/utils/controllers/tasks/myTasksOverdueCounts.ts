import prisma from "@/lib/prisma";
import type { ApplyMyTasksViewOptions, MyTasksTask } from "@/lib/myTasksFiltering";
import {
  overdueCountsFromAuthorizedTasks,
  type MyTasksScopeMembership,
  type MyTasksViewOverdueCounts,
} from "@/lib/myTasksOverdueCounts";
import {
  MY_TASKS_SCOPE_VALUES,
  buildMyTasksScopeOr,
  DEFAULT_MY_TASKS_SCOPES,
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import { listRunning } from "@/lib/timeTracking";
import type { IFilterRuntimeContext } from "@/models/Filters/model";
import type { MyTasksSavedView } from "@/models/MyTasksView";
import type { ISection } from "@/models/model";
import getMyTasks from "./myTasks";

const taskIdsForScope = async (
  userId: number,
  taskIds: number[],
  scope: MyTasksScope,
): Promise<Set<number>> => {
  if (taskIds.length === 0) return new Set();
  const scopeOr = buildMyTasksScopeOr(userId, [scope]);
  const rows = await prisma.task.findMany({
    where: { id: { in: taskIds }, OR: scopeOr },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
};

export async function loadMyTasksScopeMembership(
  userId: number,
  taskIds: number[],
  scopesEnabled: boolean,
): Promise<MyTasksScopeMembership> {
  if (!scopesEnabled || taskIds.length === 0) {
    return {
      userId,
      watchingIds: new Set<number>(),
      mentionedIds: new Set<number>(),
    };
  }
  const [watchingIds, mentionedIds] = await Promise.all([
    taskIdsForScope(userId, taskIds, "watching"),
    taskIdsForScope(userId, taskIds, "mentioned"),
  ]);
  return { userId, watchingIds, mentionedIds };
}

export async function getMyTasksOverdueCounts(args: {
  userId: number;
  views: MyTasksSavedView[];
  scopesEnabled: boolean;
  snoozeEnabled: boolean;
  applyFilterSettings: boolean;
  now?: Date;
  timeZone: string;
}): Promise<MyTasksViewOverdueCounts> {
  const now = args.now ?? new Date();
  const queryScopes = args.scopesEnabled
    ? [...MY_TASKS_SCOPE_VALUES]
    : [...DEFAULT_MY_TASKS_SCOPES];
  const [myTasks, running] = await Promise.all([
    getMyTasks(args.userId, true, queryScopes, {
      throwOnError: true,
      snoozeEnabled: args.snoozeEnabled,
      showSnoozed: args.snoozeEnabled,
    }),
    listRunning(args.userId),
  ]);
  const tasks = (myTasks.sections as ISection[]).flatMap(
    (section) => section.items as MyTasksTask[],
  );
  const membership = await loadMyTasksScopeMembership(
    args.userId,
    tasks.map((task) => task.id),
    args.scopesEnabled,
  );
  const runtimeContext: IFilterRuntimeContext = {
    runningTaskIds: new Set(running.map((entry) => entry.taskId)),
  };
  const options: ApplyMyTasksViewOptions = {
    applyFilterSettings: args.applyFilterSettings,
    runtimeContext,
    timeZone: args.timeZone,
  };
  return overdueCountsFromAuthorizedTasks(
    tasks,
    args.views,
    membership,
    now,
    options,
    args.scopesEnabled,
  );
}
