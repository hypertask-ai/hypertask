"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import Unauthorized from "@/app/unauthorized/page";
import { cachedTaskDetailKey, TaskAccessDeniedError } from "@/lib/navigation/cachedTaskDetail";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { mergeRealtimeTaskDetail, preserveTaskAssigneesChangedDuringFetch, shouldPreserveTaskEditorContent } from "@/lib/realtime/taskDetailRefresh";

import TaskDetail from "@/app/detail/[...slug]/TaskDetailComp";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6899_STABLE_LAYOUT_FLAG, HTPR_6962_KEEP_ASSIGNEE_FLAG, HTPR_7004_NO_LOADING_FLASH_FLAG } from "@/lib/flags/keys";
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
};

function RefreshCachedTask({ task, dataUpdatedAt, error, refetch, currentTaskRef, assigneeSnapshotRef, children }: { task: ITask; dataUpdatedAt: number; error: Error | null; refetch: () => Promise<unknown>; currentTaskRef: RefObject<ITask | null>; assigneeSnapshotRef: RefObject<{ assignees: ITask["assignees"] } | null>; children: ReactNode }) {
  const keepAssignee = useFlag(HTPR_6962_KEEP_ASSIGNEE_FLAG);
  const noLoadingFlash = useFlag(HTPR_7004_NO_LOADING_FLASH_FLAG);
  const { currentTask, setCurrentTask, setDescription, editMode, hasDraft, hasDraftInit, uploadingDescription } = useTaskContext();
  currentTaskRef.current = currentTask;
  const previousTask = useRef(task);
  const previousUpdatedAt = useRef(dataUpdatedAt);
  const preserveContent = shouldPreserveTaskEditorContent({ hasDraft, hasDraftInit, editMode, uploadingDescription });
  const editing = Boolean(editMode) || preserveContent;
  useEffect(() => {
    if (!error) return;
    // A refresh failure must not replace an authorized cached view with a cold document's Suspense fallback.
    if (editing || (noLoadingFlash && !(error instanceof TaskAccessDeniedError))) {
      const retry = window.setTimeout(() => { void refetch(); }, 1000);
      return () => window.clearTimeout(retry);
    }
    // Recover through the authorized route only when no local work is active.
    window.location.replace(window.location.href);
  }, [error, editing, noLoadingFlash, refetch]);
  useEffect(() => {
    // Structural sharing can retain task identity after an identical server read.
    if (previousTask.current === task && (!keepAssignee || previousUpdatedAt.current === dataUpdatedAt)) return;
    previousTask.current = task;
    previousUpdatedAt.current = dataUpdatedAt;
    const preserveContent = shouldPreserveTaskEditorContent({ hasDraft, hasDraftInit, editMode, uploadingDescription });
    const assigneeSnapshot = assigneeSnapshotRef.current;
    setCurrentTask((current) => {
      const refreshed = preserveTaskAssigneesChangedDuringFetch(
        current,
        mergeRealtimeTaskDetail(current, task, !preserveContent),
        assigneeSnapshot?.assignees,
        keepAssignee && assigneeSnapshot !== null,
      );
      return editMode === "title" && current ? { ...refreshed, title: current.title } : refreshed;
    });
    if (!preserveContent) setDescription(task.description_?.content ?? "");
    // Reconcile a new server snapshot once, not when editing ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, dataUpdatedAt]);
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
}: EmbeddedTaskDetailProps) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const queryClient = useQueryClient();
  const { data: preferences } = useGetUserPreferences();
  const stableLayoutFlag = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const currentTaskRef = useRef<ITask | null>(initialTask ?? null);
  const assigneeSnapshotRef = useRef<{ assignees: ITask["assignees"] } | null>(null);
  const taskQuery = useQuery({
    queryKey: embedded ? ["swipe-unread-task-detail", taskId] : cachedTaskDetailKey(currentUser?.id, taskId),
    queryFn: async ({ signal }) => {
      assigneeSnapshotRef.current = { assignees: currentTaskRef.current?.assignees };
      return fetchTaskDetail(taskId, projectId, uniqueIndex, signal);
    },
    initialData: initialTask,
    ...(embedded ? {} : { retry: false, refetchOnMount: "always" as const }),
  });
  const commentsQuery = useQuery({
    queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
    queryFn: () => fetchCommentsHelper(taskId, currentUser.id, queryClient),
    enabled: embedded && Boolean(currentUser?.id),
  });

  const initialSerializedTask = useRef<string | undefined>(undefined);
  if (taskQuery.data && initialSerializedTask.current === undefined) {
    initialSerializedTask.current = JSON.stringify(taskQuery.data);
  }

  if (embedded && (taskQuery.isError || commentsQuery.isError)) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
        Unable to load this task
      </div>
    );
  }

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
      cachedNavigation={!embedded && stableLayoutFlag}
      scrollElementRef={scrollElementRef}
    >
      {embedded ? detail : (
        <RefreshCachedTask task={task} dataUpdatedAt={taskQuery.dataUpdatedAt} error={taskQuery.error} refetch={taskQuery.refetch} currentTaskRef={currentTaskRef} assigneeSnapshotRef={assigneeSnapshotRef}>
          {detail}
        </RefreshCachedTask>
      )}
    </TasksProvider>
  );
};

export default EmbeddedTaskDetail;
