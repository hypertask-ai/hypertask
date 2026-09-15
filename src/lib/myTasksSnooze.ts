import type { Prisma } from "@prisma/client";

/** Two years is enough for "pick a date"; farther values are almost always typos. */
export const MY_TASKS_SNOOZE_MAX_MS = 1000 * 60 * 60 * 24 * 365 * 2;

export type MyTasksSnoozeAnnotation = {
  currentUserAssignmentId: number | null;
  currentUserSnoozeUntil: string | null;
};

/** Prisma hide clause: drop tasks whose current-user person assignment is snoozed. */
export function myTasksActiveSnoozeWhere(
  userId: number,
  now: Date = new Date(),
): Prisma.TaskWhereInput {
  return {
    NOT: {
      assignees: {
        some: {
          userId,
          agentId: null,
          snoozeUntil: { gt: now },
        },
      },
    },
  };
}

export function isMyTasksSnoozed(
  snoozeUntil: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!snoozeUntil) return false;
  const time = new Date(snoozeUntil).getTime();
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * Parse an API snoozeUntil value.
 * - null / "" clears
 * - past timestamps clear (same effect as null)
 * - invalid or > max future rejects
 */
export function parseMyTasksSnoozeUntil(
  value: unknown,
  now: Date = new Date(),
): { ok: true; snoozeUntil: Date | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, snoozeUntil: null };
  }
  if (typeof value !== "string" && !(value instanceof Date)) {
    return { ok: false, error: "snoozeUntil must be an ISO date string or null" };
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return { ok: false, error: "snoozeUntil is not a valid date" };
  }
  if (time <= now.getTime()) {
    return { ok: true, snoozeUntil: null };
  }
  if (time - now.getTime() > MY_TASKS_SNOOZE_MAX_MS) {
    return { ok: false, error: "snoozeUntil is too far in the future" };
  }
  return { ok: true, snoozeUntil: date };
}

/** Strip Assignees.snoozeUntil before sending tasks to clients. */
export function omitAssigneeSnoozeUntil<T extends { snoozeUntil?: unknown }>(
  row: T,
): Omit<T, "snoozeUntil"> {
  const { snoozeUntil: _drop, ...rest } = row;
  return rest;
}

export function annotateMyTasksSnoozeFields<
  T extends {
    assignees?: Array<{
      id: number;
      userId: number;
      agentId?: string | null;
      snoozeUntil?: Date | string | null;
    }>;
  },
>(
  tasks: T[],
  userId: number,
): Array<T & MyTasksSnoozeAnnotation> {
  return tasks.map((task) => {
    const assignees = task.assignees ?? [];
    const mine = assignees.find(
      (row) => row.userId === userId && row.agentId == null,
    );
    return {
      ...task,
      assignees: assignees.map(omitAssigneeSnoozeUntil) as T["assignees"],
      currentUserAssignmentId: mine?.id ?? null,
      currentUserSnoozeUntil: mine?.snoozeUntil
        ? new Date(mine.snoozeUntil).toISOString()
        : null,
    };
  });
}

export function nearestFutureSnoozeUntil(
  values: Array<Date | string | null | undefined>,
  now: Date = new Date(),
): string | null {
  let nearest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time <= now.getTime()) continue;
    if (nearest === null || time < nearest) nearest = time;
  }
  return nearest === null ? null : new Date(nearest).toISOString();
}
