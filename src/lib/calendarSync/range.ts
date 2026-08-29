import type { CalendarSettings } from "@/models/Calendar/model";

export const CALENDAR_RANGE_MAX_DAYS = 70;

export type CalendarVisibleRange = {
  rangeStart: string;
  rangeEndExclusive: string;
  startIso: string;
  endExclusiveIso: string;
  timezone: string;
};

const localDateKey = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const localMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addLocalDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const weekStartIndex = (
  date: Date,
  weekStartsOn: CalendarSettings["weekStartsOn"],
) => (weekStartsOn === "monday" ? (date.getDay() + 6) % 7 : date.getDay());

export const resolveCalendarTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const buildCalendarVisibleRange = ({
  anchor,
  view,
  weekStartsOn,
  timezone = resolveCalendarTimezone(),
}: {
  anchor: Date;
  view: "month" | "week" | "day";
  weekStartsOn: CalendarSettings["weekStartsOn"];
  timezone?: string;
}): CalendarVisibleRange => {
  const normalizedAnchor = localMidnight(anchor);
  let start = normalizedAnchor;
  let endExclusive = addLocalDays(normalizedAnchor, 1);

  if (view === "week") {
    start = addLocalDays(normalizedAnchor, -weekStartIndex(normalizedAnchor, weekStartsOn));
    endExclusive = addLocalDays(start, 7);
  } else if (view === "month") {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    start = addLocalDays(monthStart, -weekStartIndex(monthStart, weekStartsOn));
    endExclusive = addLocalDays(
      monthEnd,
      7 - weekStartIndex(monthEnd, weekStartsOn),
    );
  }

  return {
    rangeStart: localDateKey(start),
    rangeEndExclusive: localDateKey(endExclusive),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    timezone,
  };
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateKeyInTimezone = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const validateCalendarVisibleRange = (
  value: CalendarVisibleRange,
): CalendarVisibleRange | null => {
  if (
    !DATE_KEY_PATTERN.test(value.rangeStart) ||
    !DATE_KEY_PATTERN.test(value.rangeEndExclusive) ||
    !value.timezone ||
    value.timezone.length > 100
  ) {
    return null;
  }

  const start = new Date(value.startIso);
  const endExclusive = new Date(value.endExclusiveIso);
  const duration = endExclusive.getTime() - start.getTime();
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(endExclusive.getTime()) ||
    duration <= 0 ||
    duration > (CALENDAR_RANGE_MAX_DAYS * 24 + 2) * 60 * 60 * 1_000
  ) {
    return null;
  }

  try {
    if (
      dateKeyInTimezone(start, value.timezone) !== value.rangeStart ||
      dateKeyInTimezone(endExclusive, value.timezone) !== value.rangeEndExclusive
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return value;
};
