import { COMMENT_EVENT, TASK_EVENT } from "./shared";

type TaskDetailRealtimeRefreshInput = {
  event: string;
  currentUserId?: number | string | null;
  originUserId?: number | string | null;
};

type RealtimeTaskIdentity = {
  id?: number | null;
  projectId?: number | null;
  uniqueIndex?: number | string | null;
};

type RealtimeTaskStaleness = RealtimeTaskIdentity & {
  description?: string;
  description_?: unknown;
  descriptionJson?: unknown;
  sectionChangedAt?: string;
  lastCommentAt?: string | null;
};

export function shouldRefetchTaskDetail({
  event,
}: TaskDetailRealtimeRefreshInput): boolean {
  // A comment advances lastCommentAt, while a task change can advance
  // sectionChangedAt. Both fields feed the staleness row, including when the
  // event came from another tab owned by the same user.
  return event === COMMENT_EVENT || event === TASK_EVENT;
}

export function shouldSyncTaskDetailContent(
  event: string,
  preserveEditorContent: boolean
): boolean {
  // Comment events update metadata such as lastCommentAt, but must not replace
  // an unsaved description or attachment draft in the open editor. Generic
  // task events may sync content only while the editor has no active draft.
  return event === TASK_EVENT && !preserveEditorContent;
}

export function shouldPreserveTaskEditorContent({
  hasDraft,
  hasDraftInit,
  editMode,
  uploadingDescription,
}: {
  hasDraft: boolean;
  hasDraftInit: boolean;
  editMode?: string | null;
  uploadingDescription?: unknown;
}): boolean {
  return (
    hasDraft ||
    hasDraftInit ||
    editMode === "description" ||
    editMode === "description-ai" ||
    Boolean(uploadingDescription)
  );
}

export function mergeRealtimeTaskDetail<T extends RealtimeTaskStaleness>(
  currentTask: T | null,
  fetchedTask: T,
  includeTaskContent: boolean
): T {
  const isSameTask =
    currentTask?.id != null &&
    currentTask.id === fetchedTask.id &&
    currentTask.projectId === fetchedTask.projectId &&
    String(currentTask.uniqueIndex) === String(fetchedTask.uniqueIndex);

  if (!isSameTask || includeTaskContent) return fetchedTask;

  // Apply remote task changes while retaining every representation of the
  // locally edited description. In particular, preserving description_ keeps
  // its attachment array stable for the editor synchronization effects.
  return {
    ...fetchedTask,
    description: currentTask.description,
    description_: currentTask.description_,
    descriptionJson: currentTask.descriptionJson,
  };
}

type TaskDetailQueryClient<T> = {
  cancelQueries: (opts: { queryKey: unknown[] }) => Promise<unknown>;
  setQueryData: (key: unknown[], data: T) => void;
};

/** Cancel stale react-query fetches before writing a realtime task payload. */
export async function refreshTaskDetailQueryCache<T>({
  queryClient,
  taskId,
  fetchTask,
}: {
  queryClient: TaskDetailQueryClient<T>;
  taskId: number;
  fetchTask: () => Promise<T | null>;
}): Promise<T | null> {
  await queryClient.cancelQueries({ queryKey: ["task-", taskId] });
  const task = await fetchTask();
  if (task) {
    queryClient.setQueryData(["task-", taskId], task);
  }
  return task;
}

export function shouldApplyRealtimeTaskDetail({
  cancelled,
  expectedTaskId,
  expectedProjectId,
  expectedUniqueIndex,
  task,
}: {
  cancelled: boolean;
  expectedTaskId: number;
  expectedProjectId: number;
  expectedUniqueIndex: number | string;
  task: RealtimeTaskIdentity;
}): boolean {
  return (
    !cancelled &&
    task.id === expectedTaskId &&
    task.projectId === expectedProjectId &&
    String(task.uniqueIndex) === String(expectedUniqueIndex)
  );
}
