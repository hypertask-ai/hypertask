
export const TASK_DETAIL_SUSPENSE_COMMIT_MARK = "ht-task-detail-suspense-commit";
export const TASK_DETAIL_COMP_MOUNT_MARK = "ht-task-detail-comp-mount";
export const TASK_DETAIL_COMMENTS_REQUEST_MARK =
  "ht-task-detail-comments-request-start";
export const TASK_DETAIL_USABLE_MARK = "ht-task-detail-usable";
const DYNAMIC_IMPORT_MARK_PREFIX = "ht-task-detail-import:";

const DYNAMIC_IMPORT_NAMES = [
  "KeyboardShortcuts",
  "DeleteCommentById",
  "NewCommentComponent",
  "TaskMovement",
  "Tooltip",
  "AttachmentCarousel",
  "ConfirmTaskDelete",
  "MoveTaskGlobal",
] as const;

export const markTaskDetailPhase = (name: string): void => {
  if (typeof performance === "undefined") return;
  try {
    performance.mark(name);
  } catch {
  }
};

export const instrumentedDynamicImport = <T>(
  name: string,
  loader: () => Promise<T>,
): (() => Promise<T>) => {
  return () =>
    loader().then((mod) => {
      markTaskDetailPhase(`${DYNAMIC_IMPORT_MARK_PREFIX}${name}`);
      return mod;
    });
};

const readRawMarkStart = (name: string): number | null => {
  if (
    typeof performance === "undefined" ||
    typeof performance.getEntriesByName !== "function"
  ) {
    return null;
  }
  try {
    const entries = performance.getEntriesByName(name, "mark");
    const entry = entries[entries.length - 1];
    return entry ? entry.startTime : null;
  } catch {
    return null;
  }
};

const readMarkMs = (name: string, notBeforeMs: number): number | null => {
  const raw = readRawMarkStart(name);
  if (raw === null) return null;
  if (raw < notBeforeMs) return null;
  return Math.round(raw);
};

export type TaskDetailPhaseTimings = {
  phase_suspense_commit_ms: number | null;
  phase_comp_mount_ms: number | null;
  phase_comments_request_ms: number | null;
  phase_usable_ms: number | null;
  phase_dynamic_imports: string | null;
};

export const readTaskDetailPhaseTimings = (): TaskDetailPhaseTimings => {
  const rawSuspenseCommit = readRawMarkStart(TASK_DETAIL_SUSPENSE_COMMIT_MARK);
  const suspenseCommitMs =
    rawSuspenseCommit === null ? null : Math.round(rawSuspenseCommit);
  const notBefore = rawSuspenseCommit ?? 0;

  let dynamicImports: string | null = null;
  try {
    const resolved: { name: string; ms: number }[] = [];
    for (const name of DYNAMIC_IMPORT_NAMES) {
      const ms = readMarkMs(`${DYNAMIC_IMPORT_MARK_PREFIX}${name}`, notBefore);
      if (ms !== null) resolved.push({ name, ms });
    }
    dynamicImports = resolved.length ? JSON.stringify(resolved) : null;
  } catch {
    dynamicImports = null;
  }

  return {
    phase_suspense_commit_ms: suspenseCommitMs,
    phase_comp_mount_ms: readMarkMs(TASK_DETAIL_COMP_MOUNT_MARK, notBefore),
    phase_comments_request_ms: readMarkMs(
      TASK_DETAIL_COMMENTS_REQUEST_MARK,
      notBefore,
    ),
    phase_usable_ms: readMarkMs(TASK_DETAIL_USABLE_MARK, notBefore),
    phase_dynamic_imports: dynamicImports,
  };
};
