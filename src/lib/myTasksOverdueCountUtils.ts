import {
  DEFAULT_MY_TASKS_SCOPES,
  effectiveMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";

export type MyTasksViewOverdueCounts = {
  all: number;
  byViewId: Record<number, number>;
};

export const EMPTY_MY_TASKS_VIEW_OVERDUE_COUNTS: MyTasksViewOverdueCounts = {
  all: 0,
  byViewId: {},
};

export type MyTasksScopeMembership = {
  userId: number;
  watchingIds: Set<number>;
  mentionedIds: Set<number>;
};

const creatorId = (task: { userId?: unknown }): number | null => {
  const value = task.userId;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
};

/** Whether a loaded My Tasks row belongs to one of the view's scopes. */
export function taskMatchesMyTasksScopes(
  task: {
    id: number;
    userId?: unknown;
    assignees?: Array<{ userId?: number | null; agentId?: string | null }>;
  },
  scopes: MyTasksScope[] | undefined,
  membership: MyTasksScopeMembership,
): boolean {
  for (const scope of effectiveMyTasksScopes(
    scopes ?? DEFAULT_MY_TASKS_SCOPES,
    true,
  )) {
    if (scope === "assigned") {
      const assigned = (task.assignees ?? []).some(
        (row) =>
          row.userId === membership.userId &&
          (row.agentId === null || row.agentId === undefined),
      );
      if (assigned) return true;
    }
    if (scope === "created" && creatorId(task) === membership.userId) {
      return true;
    }
    if (scope === "watching" && membership.watchingIds.has(task.id)) {
      return true;
    }
    if (scope === "mentioned" && membership.mentionedIds.has(task.id)) {
      return true;
    }
  }
  return false;
}

/** Keep the active tab's count on the dataset that tab actually loaded. */
export function mergeActiveViewOverdueCounts(
  remote: MyTasksViewOverdueCounts,
  activeViewId: number | null,
  activeCount: number,
): MyTasksViewOverdueCounts {
  if (activeViewId === null) {
    return { all: activeCount, byViewId: remote.byViewId };
  }
  return {
    all: remote.all,
    byViewId: { ...remote.byViewId, [activeViewId]: activeCount },
  };
}

export function parseMyTasksViewOverdueCounts(
  body: unknown,
): MyTasksViewOverdueCounts | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.all !== "number" || !Number.isFinite(record.all)) {
    return null;
  }
  if (!record.byViewId || typeof record.byViewId !== "object") return null;
  const byViewId: Record<number, number> = {};
  for (const [key, value] of Object.entries(
    record.byViewId as Record<string, unknown>,
  )) {
    const id = Number(key);
    if (!Number.isFinite(id) || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    byViewId[id] = value;
  }
  return { all: record.all, byViewId };
}

/** Milliseconds until the next local calendar day. Always at least 1ms. */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}
