"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import Unauthorized from "@/app/unauthorized/page";
import { cachedTaskDetailKey, TaskAccessDeniedError } from "@/lib/navigation/cachedTaskDetail";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { mergeRealtimeTaskDetail, shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";

import TaskDetail from "@/app/detail/[...slug]/TaskDetailComp";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import globalConstants from "@/lib/constants";
import { FollowersProvider } from "@/lib/contexts/TaskDetail/FollowersProvider";
import { TasksProvider } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useRecoilValue } from "@/lib/state";
import type { ITask } from "@/models/model";
import { currentUserAtom } from "@/store";
import { fetchCommentsHelper } from "@/utils/api/Task Detail";

type EmbeddedTaskDetailProps = {
  taskId: number;
  projectId: number;
  uniqueIndex: number;
  scrollElementRef?: RefObject<HTMLDivElement | null>;
  initialTask?: ITask;
  embedded?: boolean;
  pendingFallback?: ReactNode;
};

function RefreshCachedTask({ task, error, refetch, children }: { task: ITask; error: Error | null; refetch: () => Promise<unknown>; children: ReactNode }) {
  const { setCurrentTask, setDescription, editMode, hasDraft, hasDraftInit, uploadingDescription } = useTaskContext();
  const previousTask = useRef(task);
  const preserveContent = shouldPreserveTaskEditorContent({ hasDraft, hasDraftInit, editMode, uploadingDescription });
  const editing = Boolean(editMode) || preserveContent;
  useEffect(() => {
    if (!error) return;
    if (editing) {
      const retry = window.setTimeout(() => { void refetch(); }, 1000);
      return () => window.clearTimeout(retry);
    }
    // Recover through the authorized route only when no local work is active.
    window.location.replace(window.location.href);
  }, [error, editing, refetch]);
  useEffect(() => {
    if (previousTask.current === task) return;
    previousTask.current = task;
    const preserveContent = shouldPreserveTaskEditorContent({ hasDraft, hasDraftInit, editMode, uploadingDescription });
    setCurrentTask((current) => {
      const refreshed = mergeRealtimeTaskDetail(current, task, !preserveContent);
      return editMode === "title" && current ? { ...refreshed, title: current.title } : refreshed;
    });
    if (!preserveContent) setDescription(task.description_?.content ?? "");
    // Reconcile a new server snapshot once, not when editing ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);
  if (error instanceof TaskAccessDeniedError) return <Unauthorized />;
  return children;
}

const fetchTaskDetail = async (taskId: number, projectId: number, uniqueIndex: number, signal: AbortSignal) => {
  const response = await fetch(
    `/api/tasks/getTask?project=project-${projectId}&uniqueIndex=${uniqueIndex}`,
    { signal },
  );
  if ([401, 403, 404].includes(response.status)) throw new TaskAccessDeniedError();
  if (!response.ok) throw new Error("Unable to load task");
  const task = (await response.json()) as ITask | null;
  // The existing endpoint returns JSON null when the authorized task no longer exists.
  if (!task || task.id !== taskId || task.status === "Deleted" || task.projectId !== projectId || task.uniqueIndex !== uniqueIndex) {
    throw new TaskAccessDeniedError();
  }
  return task;
};

const EmbeddedTaskDetail = ({
  taskId,
  projectId,
  uniqueIndex,
  scrollElementRef,
  initialTask,
  embedded = true,
  pendingFallback = null,
}: EmbeddedTaskDetailProps) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const queryClient = useQueryClient();
  const { data: preferences } = useGetUserPreferences();
  const taskQuery = useQuery({
    queryKey: embedded ? ["swipe-unread-task-detail", taskId] : cachedTaskDetailKey(currentUser?.id, taskId),
    queryFn: ({ signal }) => fetchTaskDetail(taskId, projectId, uniqueIndex, signal),
    initialData: initialTask,
    ...(embedded ? {} : { retry: false, refetchOnMount: "always" as const }),
  });
  const commentsQuery = useQuery({
    queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
    queryFn: () => fetchCommentsHelper(taskId, currentUser.id, queryClient),
    enabled: Boolean(currentUser?.id),
    ...(embedded ? {} : { staleTime: 30_000 }),
  });
  const pagesQuery = useQuery({
    queryKey: ["task-pages", currentUser?.id, taskId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/pages/list?task_id=${taskId}`, { signal });
      if (!response.ok) throw new Error("Unable to load pages");
      const result = await response.json();
      return Array.isArray(result?.pages) ? result.pages : [];
    },
    enabled: !embedded && Boolean(currentUser?.id),
    retry: false,
    refetchOnMount: "always",
  });
  // The board snapshot lacks author, relations, comments and pages. Initialize
  // the detail providers together, rather than moving already-painted cards.
  const snapshotPending = !embedded && !(taskQuery.error instanceof TaskAccessDeniedError) && (
    (!taskQuery.isFetchedAfterMount && !taskQuery.isError) ||
    commentsQuery.isFetching || commentsQuery.isPending || pagesQuery.isFetching || pagesQuery.isPending
  );
  const initialSerializedTask = useRef<string | undefined>(undefined);
  if (!snapshotPending && taskQuery.data && initialSerializedTask.current === undefined) {
    initialSerializedTask.current = JSON.stringify(taskQuery.data);
  }

  if (embedded && (taskQuery.isError || commentsQuery.isError)) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
        Unable to load this task
      </div>
    );
  }

  if (snapshotPending && initialSerializedTask.current === undefined) return pendingFallback;

  const task = taskQuery.data;
  const comments = commentsQuery.data ?? (embedded ? undefined : { pending: true });
  if (!task || !comments || !currentUser?.id) {
    if (!embedded) return null;
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
        Loading task…
      </div>
    );
  }

  // Only the guarded refresh path may replace content after the editor mounts.
  const serializedTask = embedded ? JSON.stringify(task) : initialSerializedTask.current!;
  const serializedComments = JSON.stringify(comments);
  const slugs = [`project-${projectId}`, String(uniqueIndex)];

  const detail = (
    <FollowersProvider>
      <TaskDetail
        key={`swipe-unread-task-detail-${taskId}`}
        allowPerks
        isMobile={false}
        _currentUser={currentUser}
        _slugs={slugs}
        embedded={embedded}
      />
    </FollowersProvider>
  );

  return (
    <TasksProvider
      key={`swipe-unread-task-provider-${taskId}`}
      stack={{ stack: preferences.commentsStacked }}
      _initialStacked={"stacked" in comments ? comments.stacked : {}}
      _comments={serializedComments}
      allowPerks
      parsedTask={serializedTask}
      scrollSetting={preferences.scrollSetting}
      embedded={embedded}
      scrollElementRef={scrollElementRef}
    >
      {embedded ? detail : (
        <RefreshCachedTask task={task} error={taskQuery.error} refetch={taskQuery.refetch}>
          {detail}
        </RefreshCachedTask>
      )}
    </TasksProvider>
  );
};

export default EmbeddedTaskDetail;
