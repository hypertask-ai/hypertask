import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import globalConstants from "@/lib/constants";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { ITask, ITasksPlaylist } from "@/models/model";
import { fetchSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask";
import globalAPIHandlers from "@/utils/api/global";
import {
  fetchCommentsHelper,
  getAllFollowers,
  getDraftsHelper,
} from "@/utils/api/Task Detail";

// 5 min: the opened view refetches per its own query config anyway, so this
// only bounds how often the same neighbor is re-prefetched while navigating.
// At 15s, J/K-ing an inbox re-fired the whole fan-out constantly (HTPR-3998).
const TASK_DETAIL_PREFETCH_STALE_TIME = 5 * 60 * 1000;

export type PrefetchTaskDetailTarget = {
  id: number;
  projectId: number;
};

const getTargets = (
  task: ITask,
  tasksPlayList: ITasksPlaylist[],
  index: number,
) => {
  const playlistIndex = tasksPlayList.findIndex((item) => item.id === task.id);
  const activeIndex = playlistIndex >= 0 ? playlistIndex : index;
  const seenTaskIds = new Set<number>();

  return [activeIndex - 1, activeIndex, activeIndex + 1].reduce<PrefetchTaskDetailTarget[]>(
    (targets, taskIndex) => {
      const item = tasksPlayList[taskIndex];
      const taskId = item?.id ?? (taskIndex === activeIndex ? task.id : undefined);
      const projectId = item?.projectId ?? task.projectId;

      if (!taskId || !projectId || seenTaskIds.has(taskId)) return targets;

      seenTaskIds.add(taskId);
      targets.push({ id: taskId, projectId });
      return targets;
    },
    [],
  );
};

export const usePrefetchTaskDetailTargets = ({
  userId,
}: {
  userId?: number;
}) => {
  const queryClient = useQueryClient();

  return useCallback((targets: PrefetchTaskDetailTarget[]) => {
    const prefetch = (
      queryKey: readonly unknown[],
      queryFn: () => Promise<unknown> | unknown,
    ) => {
      void queryClient
        .prefetchQuery({
          queryKey,
          queryFn,
          staleTime: TASK_DETAIL_PREFETCH_STALE_TIME,
        })
        .catch(() => undefined);
    };

    targets.forEach((target) => {
      prefetch(["task-", target.id], () => fetchSingleTask(target.id));
      prefetch([taskDetailConfig.queryKeys.priority, target.id], () =>
        globalAPIHandlers.getPriorityForTask(target.id),
      );
      prefetch([taskDetailConfig.queryKeys.estimate, target.id], () =>
        globalAPIHandlers.getEstimateForTask(target.id),
      );
      prefetch([taskDetailConfig.queryKeys.taskLabels, target.id], () =>
        globalAPIHandlers.getAllTaskLabels(target.id),
      );
      prefetch(["followersFor:", target.id], () => getAllFollowers(target.id));
      prefetch([taskDetailConfig.queryKeys.moveTaskModal, target.projectId], () =>
        globalAPIHandlers.getSectionsForMoveTask(target.projectId),
      );

      if (!userId) return;

      prefetch([globalConstants.CommentsTQPrefixKey, target.id], () =>
        fetchCommentsHelper(target.id, userId, queryClient),
      );
      prefetch(["draft for [task,userId]:", target.id, userId], () =>
        getDraftsHelper(target.id, userId),
      );
      // Share links are NOT prefetched: /api/share/createShareLink is a write
      // (creates the link server-side) — firing it per focused neighbor created
      // share links for tasks the user never opened (HTPR-3998).
    });
  }, [queryClient, userId]);
};

export const usePrefetchTaskDetail = ({
  task,
  tasksPlayList,
  index,
  userId,
}: {
  task: ITask;
  tasksPlayList: ITasksPlaylist[];
  index: number;
  userId?: number;
}) => {
  const prefetchTaskDetailTargets = usePrefetchTaskDetailTargets({ userId });

  return useCallback(() => {
    prefetchTaskDetailTargets(getTargets(task, tasksPlayList, index));
  }, [index, prefetchTaskDetailTargets, task, tasksPlayList]);
};
