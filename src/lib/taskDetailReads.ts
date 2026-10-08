import type { QueryClient } from "@tanstack/react-query";
import type { ITask } from "@/models/model";
import { cachedTaskDetailKey, TaskAccessDeniedError } from "@/lib/navigation/cachedTaskDetail";
import type { TaskDetailMeta } from "@/utils/api/global/apiHelpers/getTaskDetailMeta";
import axios from "axios";

export const taskDetailReadKey = (userId: number, taskId: number) =>
  [...cachedTaskDetailKey(userId, taskId), "read"] as const;
export const taskDetailMetaKey = (taskId: number) =>
  ["task-detail-meta", taskId] as const;

// Match comments' existing mount freshness budget, not a longer realtime delay.
export const TASK_DETAIL_READ_FRESH_MS = 30_000;
export const shouldRefetchDetailOnMount = (query: { state: { dataUpdatedAt: number; isInvalidated: boolean } }) =>
  query.state.isInvalidated || Date.now() - query.state.dataUpdatedAt >= TASK_DETAIL_READ_FRESH_MS;

export function refreshTaskDetailReadAfterWrite(queryClient: QueryClient, userId: number, taskId: number, updates: Partial<ITask> = {}) {
  const queryKey = taskDetailReadKey(userId, taskId);
  // A pre-write response must not replace the local snapshot used on reopen.
  void queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<ITask>(queryKey, previous => previous ? { ...previous, ...updates } : undefined);
  void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
}

export async function fetchScopedTaskDetail(taskId: number, projectId: number, uniqueIndex: number, signal: AbortSignal | undefined, options: Pick<RequestInit, "cache" | "credentials">) {
  const response = await fetch(
    `/api/tasks/getTask?project=project-${projectId}&uniqueIndex=${uniqueIndex}`,
    { signal, ...options },
  );
  if ([401, 403, 404].includes(response.status)) throw new TaskAccessDeniedError();
  if (!response.ok) throw new Error("Unable to load task");
  const task = await response.json() as ITask | null;
  if (!task || task.id !== taskId || task.status === "Deleted" || task.projectId !== projectId || task.uniqueIndex !== uniqueIndex) {
    throw new TaskAccessDeniedError();
  }
  return task;
}

const metaFields = { priority: "priority", estimate: "estimate", labels: "taskLabels", followers: "followersFor:" } as const;

export async function fetchTaskDetailMeta(queryClient: QueryClient, taskId: number, refresh = false, freshForMs = 0) {
  const queryKey = taskDetailMetaKey(taskId);
  // Explicit post-write/focus/realtime refreshes must not join a pre-change read.
  if (refresh) await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    staleTime: freshForMs,
    queryFn: async ({ signal }) => {
      const { data } = await axios.get<TaskDetailMeta>(`/api/tasks/detailMeta?taskId=${taskId}`, { signal });
      for (const [field, prefix] of Object.entries(metaFields)) {
        queryClient.setQueryData([prefix, taskId], data[field as keyof TaskDetailMeta]);
      }
      return data;
    },
  });
}
