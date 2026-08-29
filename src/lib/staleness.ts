export const STALE_WARN_DAYS = 7;
export const STALE_HOT_DAYS = 20;

export interface StalenessThresholds {
  warnDays?: number | null;
  hotDays?: number | null;
}

export function daysSince(
  date: Date | string | null | undefined
): number | null {
  if (!date) return null;

  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (Number.isNaN(timestamp)) return null;

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export type StalenessLevel = "none" | "warn" | "hot";

export function stalenessLevel(
  days: number | null,
  thresholds?: StalenessThresholds,
): StalenessLevel {
  const warnDays = thresholds?.warnDays ?? STALE_WARN_DAYS;
  const hotDays = thresholds?.hotDays ?? STALE_HOT_DAYS;
  if (days === null || days < warnDays) return "none";
  if (days >= hotDays) return "hot";
  return "warn";
}

export interface TaskStaleness {
  /** Whole days since the task was created. */
  daysOnBoard: number | null;
  /** Whole days since the task last changed column. */
  daysInColumn: number | null;
  /** Whole days since the last comment (falls back to creation when never commented). */
  daysSinceLastComment: number | null;
  /** Worst of the column and comment ages under the board thresholds. */
  level: StalenessLevel;
  sectionChangedAt?: string;
  /** Absent when the task has never been commented on. */
  lastCommentAt?: string;
}

export function formatKanbanStalenessLine(
  staleness: Pick<
    TaskStaleness,
    "daysOnBoard" | "daysInColumn" | "daysSinceLastComment" | "level"
  > & { commentLevel: StalenessLevel },
): string | null {
  if (staleness.level === "none" || staleness.daysInColumn === null) {
    return null;
  }

  const boardAge =
    staleness.daysOnBoard === null ? "" : `${staleness.daysOnBoard}d on board · `;
  const commentAge =
    staleness.commentLevel === "none" ||
    staleness.daysSinceLastComment === null
      ? ""
      : ` · no comment for ${staleness.daysSinceLastComment}d`;

  return `${boardAge}${staleness.daysInColumn}d in column${commentAge}`;
}

const toIso = (date: Date | string | null | undefined): string | undefined =>
  date ? new Date(date).toISOString() : undefined;

// The staleness payload agent surfaces (MCP / CLI / API / AI chat) attach to a
// task, computed at read time from the same timestamps and thresholds the board
// UI uses, so a card and an MCP fetch never disagree about what is stale.
export function taskStaleness(task: {
  createdAt: Date | string;
  sectionChangedAt?: Date | string | null;
  lastCommentAt?: Date | string | null;
}, thresholds?: StalenessThresholds): TaskStaleness {
  const daysInColumn = daysSince(task.sectionChangedAt ?? task.createdAt);
  const daysSinceLastComment = daysSince(task.lastCommentAt ?? task.createdAt);
  const columnLevel = stalenessLevel(daysInColumn, thresholds);
  const commentLevel = stalenessLevel(daysSinceLastComment, thresholds);
  const level: StalenessLevel =
    columnLevel === "hot" || commentLevel === "hot"
      ? "hot"
      : columnLevel === "warn" || commentLevel === "warn"
      ? "warn"
      : "none";

  return {
    daysOnBoard: daysSince(task.createdAt),
    daysInColumn,
    daysSinceLastComment,
    level,
    sectionChangedAt: toIso(task.sectionChangedAt),
    lastCommentAt: toIso(task.lastCommentAt),
  };
}
