// HTPR-6047: field attribution for the task-detail readiness gap. We have no
// way to attach a CPU profiler to a real user's browser, so instead we mark
// the phases we can reach cheaply and report their elapsed time on the
// existing app_task_detail_readiness event. Every read is defensive: an
// unavailable Performance API, a mark that never fired, or a mark left over
// from an earlier task-detail mount in the same tab (a dynamic() import's
// module cache means its loader - and our mark - only fires once per
// session, not once per task) all report null, never a fabricated or stale
// number.

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
    // Telemetry must never break the page.
  }
};

// Wraps a next/dynamic() loader so the mark fires the instant the chunk's
// module resolves (downloaded, parsed, evaluated). The loader only runs once
// per session per chunk - reads below filter out a stale mark from an
// earlier mount rather than trust it.
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

// Raw (unrounded) startTime - used as the staleness threshold so a mark that
// lands a fraction of a millisecond after the reference point never gets
// rejected by comparing it against a threshold rounded up past it.
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
  // A mark from a previous task-detail mount in this tab is worse than no
  // data - never report a number that predates this page's own commit.
  if (raw < notBeforeMs) return null;
  return Math.round(raw);
};

export type TaskDetailPhaseTimings = {
  phase_suspense_commit_ms: number | null;
  phase_comp_mount_ms: number | null;
  phase_comments_request_ms: number | null;
  phase_usable_ms: number | null;
  // JSON-encoded [{name, ms}] for whichever dynamic imports resolved during
  // this mount. A flat PostHog property can't hold a nested list natively.
  phase_dynamic_imports: string | null;
};

export const readTaskDetailPhaseTimings = (): TaskDetailPhaseTimings => {
  // Everything else is only trustworthy relative to this mount - without a
  // fresh boundary-commit timestamp there's nothing to filter stale marks
  // against, so treat the window as starting at time zero (nothing is
  // filtered, which matches "we can't tell, don't guess").
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
