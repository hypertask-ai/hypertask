import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { taskChannel, COMMENT_EVENT, TASK_EVENT } from "@/lib/realtime/shared";
import {
  mergeRealtimeTaskDetail,
  refreshTaskDetailQueryCache,
  shouldApplyRealtimeTaskDetail,
  shouldRefetchTaskDetail,
  shouldSyncTaskDetailContent,
} from "@/lib/realtime/taskDetailRefresh";
import globalConstants from "@/lib/constants";
import type { IAttachment, ITask } from "@/models/model";

type RealtimePayload = {
  originUserId?: number | string | null;
};

type UseTaskCommentsRealtimeOptions = {
  currentUserId?: number | null;
  taskProjectId?: number | null;
  taskUniqueIndex?: number | string | null;
  setCurrentTask?: Dispatch<SetStateAction<ITask | null>>;
  setDescription?: Dispatch<SetStateAction<string>>;
  setDescriptionAttachments?: Dispatch<SetStateAction<IAttachment[]>>;
  preserveEditorContent?: boolean;
};

async function fetchTaskDetailForRealtime(
  projectId: number,
  uniqueIndex: number | string
): Promise<ITask | null> {
  const response = await fetch(
    `/api/tasks/getTask?project=project-${projectId}&uniqueIndex=${uniqueIndex}`
  );
  if (!response.ok) return null;
  return response.json();
}

// Subscribes the open task view to its realtime channel. On any comment event
// it refetches the comments query immediately (no timer; speed rules ban
// event-to-refetch delays, HTPR-5594) so all viewers see new comments live.
export function useTaskCommentsRealtime(
  taskId: number | null | undefined,
  options: UseTaskCommentsRealtimeOptions = {}
): void {
  const queryClient = useQueryClient();
  const wasConnected = useRef(false);
  const shouldRefetchTask = useRef(false);
  const shouldSyncTaskContent = useRef(false);
  const {
    currentUserId,
    taskProjectId,
    taskUniqueIndex,
    setCurrentTask,
    setDescription,
    setDescriptionAttachments,
    preserveEditorContent = false,
  } = options;

  useEffect(() => {
    if (taskId == null) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let refreshInFlight = false;
    let refreshRequestedDuringFlight = false;
    const startedWhileHidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    shouldRefetchTask.current = false;
    shouldSyncTaskContent.current = false;

    const runRefetch = async () => {
      if (refreshInFlight) {
        refreshRequestedDuringFlight = true;
        return;
      }

      refreshInFlight = true;
      const includeTaskRefetch = shouldRefetchTask.current;
      const includeTaskContentSync = shouldSyncTaskContent.current;
      shouldRefetchTask.current = false;
      shouldSyncTaskContent.current = false;

      const commentsRefetch = queryClient.refetchQueries({
        queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
      });

      if (
        includeTaskRefetch &&
        taskProjectId != null &&
        taskUniqueIndex != null
      ) {
        try {
          // Realtime means the cache is stale. fetchQuery can dedupe onto an
          // in-flight prefetch and return pre-change data (e.g. Archive status
          // missing after another tab archived the task — HTPR-5690).
          const task = await refreshTaskDetailQueryCache({
            queryClient,
            taskId,
            fetchTask: () =>
              fetchTaskDetailForRealtime(taskProjectId, taskUniqueIndex),
          });

          if (
            task &&
            shouldApplyRealtimeTaskDetail({
              cancelled,
              expectedTaskId: taskId,
              expectedProjectId: taskProjectId,
              expectedUniqueIndex: taskUniqueIndex,
              task,
            })
          ) {
            setCurrentTask?.((currentTask) =>
              mergeRealtimeTaskDetail(
                currentTask,
                task,
                includeTaskContentSync
              )
            );
            if (includeTaskContentSync) {
              setDescription?.(task.description_?.content ?? "");
              setDescriptionAttachments?.(
                task.description_?.attachments ?? []
              );
            }
          }
        } catch (error) {
          console.warn("[realtime] task detail refetch failed", error);
        }
      }
      try {
        await commentsRefetch;
      } finally {
        refreshInFlight = false;
        if (
          !cancelled &&
          (refreshRequestedDuringFlight || shouldRefetchTask.current)
        ) {
          refreshRequestedDuringFlight = false;
          void runRefetch();
        }
      }
    };

    const refetch = (includeTask = false, includeTaskContent = false) => {
      if (includeTask) shouldRefetchTask.current = true;
      if (includeTaskContent) shouldSyncTaskContent.current = true;
      if (refreshInFlight) {
        refreshRequestedDuringFlight = true;
        return;
      }
      void runRefetch();
    };

    const refetchActivity = (payload?: RealtimePayload) => {
      const event = COMMENT_EVENT;
      refetch(
        shouldRefetchTaskDetail({
          event,
          currentUserId,
          originUserId: payload?.originUserId,
        }),
        shouldSyncTaskDetailContent(event, preserveEditorContent)
      );
    };
    const refetchTaskAndActivity = (payload?: RealtimePayload) => {
      const event = TASK_EVENT;
      refetch(
        shouldRefetchTaskDetail({
          event,
          currentUserId,
          originUserId: payload?.originUserId,
        }),
        shouldSyncTaskDetailContent(event, preserveEditorContent)
      );
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = taskChannel(taskId);
      const channel = client.subscribe(channelName);
      channel.bind(COMMENT_EVENT, refetchActivity);
      channel.bind(TASK_EVENT, refetchTaskAndActivity);
      // Reconnect safety-net: pull once after a dropped connection recovers.
      // Skipped on the INITIAL connection (HTPR-3998) — the queries are already
      // fetching on mount, so refetching there just doubled every page load.
      // Mounted while already connected (e.g. view opened later in the session):
      // count that as connected so a real drop+recover still refetches.
      if (client.connection.state === "connected") wasConnected.current = true;
      const onConnected = () => {
        // Hidden mounts may miss changes before their deferred first connection.
        if (wasConnected.current || startedWhileHidden) {
          refetch(true, !preserveEditorContent);
        }
        wasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channel.unbind(COMMENT_EVENT, refetchActivity);
        channel.unbind(TASK_EVENT, refetchTaskAndActivity);
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      shouldRefetchTask.current = false;
      shouldSyncTaskContent.current = false;
      refreshRequestedDuringFlight = false;
      unsubscribe?.();
    };
  }, [
    taskId,
    queryClient,
    currentUserId,
    taskProjectId,
    taskUniqueIndex,
    setCurrentTask,
    setDescription,
    setDescriptionAttachments,
    preserveEditorContent,
  ]);
}
