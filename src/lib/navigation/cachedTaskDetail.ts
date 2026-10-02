import type { QueryClient } from "@tanstack/react-query";
import type { IProject, IProjectsAll, ITask } from "@/models/model";
import { isBoardRevocationTombstoned } from "@/lib/boardSync/revocationTombstone";
import { getNextRouterAwareHistoryState } from "./nextHistoryState";

export class TaskAccessDeniedError extends Error {}

export const cachedTaskDetailKey = (accountId: number, taskId: number) =>
  ["cached-task-detail", accountId, taskId] as const;

export type CachedTaskDetailLocation = {
  accountId: number;
  taskId: number;
  projectId: number;
  uniqueIndex: number;
};

export function findCachedTaskDetail(
  queryClient: QueryClient,
  accountId: number,
  projectId: number,
  uniqueIndex: number,
  suppliedTask?: ITask,
): ITask | undefined {
  if (isBoardRevocationTombstoned(accountId, projectId)) return;
  const matches = (task: ITask | undefined): task is ITask =>
    !!task && task.projectId === projectId && task.uniqueIndex === uniqueIndex &&
    task.status !== "Deleted" && (task.description_ === null || typeof task.description_?.content === "string");
  const projects = queryClient.getQueryData<IProjectsAll>(["projectsAll"]);
  const project = projects?.accountId === accountId
    ? projects.updatedProjects.find((item) => item.id === projectId)
    : undefined;
  const board = queryClient.getQueryData<{ tasks: ITask[]; project?: IProject }>([
    "boardTasks", accountId, projectId,
  ]);
  const tasks = [
    ...(project?.tasks ?? []),
    ...(project?.section?.flatMap((section) => section.items) ?? []),
    ...(board?.tasks ?? []),
    ...queryClient.getQueriesData<ITask>({ queryKey: ["cached-task-detail", accountId] }).map(([, task]) => task),
  ];
  const task = matches(suppliedTask) ? suppliedTask : tasks.find(matches);
  if (!task || queryClient.getQueryState(cachedTaskDetailKey(accountId, task.id))?.error instanceof TaskAccessDeniedError) return;
  return { ...task, subTasks: task.subTasks ?? [], project: task.project ?? project ?? board?.project };
}

export function openCachedTaskDetail({
  queryClient, accountId, projectId, uniqueIndex, href, replace = false, task,
}: {
  queryClient: QueryClient;
  accountId: number;
  projectId: number;
  uniqueIndex: number;
  href: string;
  replace?: boolean;
  task?: ITask;
}): boolean {
  const cached = findCachedTaskDetail(queryClient, accountId, projectId, uniqueIndex, task);
  if (!cached) return false;
  queryClient.setQueryData(cachedTaskDetailKey(accountId, cached.id), cached);
  const location: CachedTaskDetailLocation = { accountId, taskId: cached.id, projectId, uniqueIndex };
  // Native history publishes the cached view before any background route refresh.
  const state = {
    ...getNextRouterAwareHistoryState(window.history.state),
    cachedTaskDetail: location,
  };
  window.history[replace ? "replaceState" : "pushState"](state, "", href);
  window.dispatchEvent(new Event("cached-task-detail-navigation"));
  window.scrollTo(0, 0);
  return true;
}

export function cachedTaskDetailLocation(
  pathname: string | null,
  accountId: number | null,
  state: { cachedTaskDetail?: CachedTaskDetailLocation } | null,
): CachedTaskDetailLocation | undefined {
  const location = state?.cachedTaskDetail;
  if (!location || accountId === null || location.accountId !== accountId) return;
  if (pathname !== `/detail/project-${location.projectId}/${location.uniqueIndex}`) return;
  if (isBoardRevocationTombstoned(accountId, location.projectId)) return;
  return location;
}
