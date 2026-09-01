import type { Prisma } from "@prisma/client";

export type CalendarTaskDateRange = {
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
};

const timestamp = (value: Date | string | null | undefined): number => {
  if (value == null) return Number.NaN;
  return new Date(value).getTime();
};

export const calendarTaskOverlapsRange = (
  task: CalendarTaskDateRange,
  start: Date,
  endExclusive: Date,
): boolean => {
  const dueAt = timestamp(task.dueDate);
  const rangeStart = start.getTime();
  const rangeEnd = endExclusive.getTime();
  if (
    !Number.isFinite(dueAt) ||
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart
  ) {
    return false;
  }

  if (dueAt >= rangeStart && dueAt < rangeEnd) return true;

  const startAt = timestamp(task.startDate);
  return (
    Number.isFinite(startAt) &&
    startAt <= dueAt &&
    startAt < rangeEnd &&
    dueAt >= rangeStart
  );
};

// Prisma cannot compare startDate with dueDate. This predicate is a safe
// superset; calendarTaskOverlapsRange removes invalid intervals after the
// authorized query without risking false negatives.
export const buildCalendarTaskOverlapWhere = (
  start: Date,
  endExclusive: Date,
): Prisma.TaskWhereInput => ({
  OR: [
    { dueDate: { gte: start, lt: endExclusive } },
    {
      startDate: { not: null, lt: endExclusive },
      dueDate: { gte: start },
    },
  ],
});
