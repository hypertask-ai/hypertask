import { addDays, endOfDay, endOfWeek, startOfDay, startOfWeek } from "date-fns";

const IANA_TIME_ZONE = /^[A-Za-z0-9_+\-\/]+$/;
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseIanaTimeZone(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 64 || !IANA_TIME_ZONE.test(timeZone)) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

export function browserTimeZone(): string | null {
  try {
    return parseIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

const dateKeyInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const tzOffsetMs = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return (
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    ) - instant.getTime()
  );
};

function wallTimeInTimeZone(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const first = new Date(utcGuess - tzOffsetMs(new Date(utcGuess), timeZone));
  return new Date(utcGuess - tzOffsetMs(first, timeZone));
}

export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const [year, month, day] = dateKeyInTimeZone(now, timeZone)
    .split("-")
    .map(Number);
  return wallTimeInTimeZone(timeZone, year, month, day, 0, 0, 0, 0);
}

export function endOfDayInTimeZone(now: Date, timeZone: string): Date {
  const [year, month, day] = dateKeyInTimeZone(now, timeZone)
    .split("-")
    .map(Number);
  return wallTimeInTimeZone(timeZone, year, month, day, 23, 59, 59, 999);
}

export function startOfWeekInTimeZone(
  now: Date,
  timeZone: string,
  weekStartsOn = 1,
): Date {
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  const weekday = WEEKDAY[weekdayName as keyof typeof WEEKDAY] ?? 0;
  const delta = (weekday - weekStartsOn + 7) % 7;
  const [year, month, day] = dateKeyInTimeZone(now, timeZone)
    .split("-")
    .map(Number);
  const utcNoon = Date.UTC(year, month - 1, day - delta, 12, 0, 0);
  return startOfDayInTimeZone(new Date(utcNoon), timeZone);
}

export function endOfWeekInTimeZone(
  now: Date,
  timeZone: string,
  weekStartsOn = 1,
): Date {
  const start = startOfWeekInTimeZone(now, timeZone, weekStartsOn);
  const [year, month, day] = dateKeyInTimeZone(start, timeZone)
    .split("-")
    .map(Number);
  const utcNoon = Date.UTC(year, month - 1, day + 6, 12, 0, 0);
  return endOfDayInTimeZone(new Date(utcNoon), timeZone);
}

export type MyTasksDayBounds = {
  todayStart: Date;
  todayEnd: Date;
  weekStart: Date;
  weekEnd: Date;
};

export function myTasksDayBounds(
  now: Date,
  timeZone?: string,
): MyTasksDayBounds {
  if (!timeZone) {
    return {
      todayStart: startOfDay(now),
      todayEnd: endOfDay(now),
      weekStart: startOfWeek(now, { weekStartsOn: 1 }),
      weekEnd: endOfWeek(now, { weekStartsOn: 1 }),
    };
  }
  return {
    todayStart: startOfDayInTimeZone(now, timeZone),
    todayEnd: endOfDayInTimeZone(now, timeZone),
    weekStart: startOfWeekInTimeZone(now, timeZone),
    weekEnd: endOfWeekInTimeZone(now, timeZone),
  };
}

export function addDaysInTimeZone(
  now: Date,
  days: number,
  timeZone?: string,
): Date {
  if (!timeZone) return addDays(now, days);
  const [year, month, day] = dateKeyInTimeZone(now, timeZone)
    .split("-")
    .map(Number);
  return startOfDayInTimeZone(
    new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0)),
    timeZone,
  );
}
