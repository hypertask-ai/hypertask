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
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import { listRunning } from "@/lib/timeTracking";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8171_HIDE_TAGS_FLAG } from "@/lib/flags/definitions/htpr-8171-hide-tags";
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
): Promise<MyTasksScopeMembership> {
  if (taskIds.length === 0) {
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
  snoozeEnabled: boolean;
  applyFilterSettings: boolean;
  now?: Date;
  timeZone?: string;
}): Promise<MyTasksViewOverdueCounts> {
  const now = args.now ?? new Date();
  const queryScopes = [...MY_TASKS_SCOPE_VALUES];
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
  );
  const runtimeContext: IFilterRuntimeContext = {
    runningTaskIds: new Set(running.map((entry) => entry.taskId)),
    tagHideFilterEnabled: await isFeatureEnabled(HTPR_8171_HIDE_TAGS_FLAG, args.userId),
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
  );
}
