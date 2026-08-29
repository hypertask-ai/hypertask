// Recurrence date math for repeating tasks (HTPR-4885).
// Pure functions only — the sweep and the API route both import from here.

export const RECURRENCE_RULES = [
  "Daily",
  "Weekdays",
  "Weekly",
  "Biweekly",
  "Monthly",
] as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
  return (
    typeof value === "string" &&
    (RECURRENCE_RULES as readonly string[]).includes(value)
  );
}

export const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  Daily: "Every day",
  Weekdays: "Every weekday (Mon–Fri)",
  Weekly: "Every week",
  Biweekly: "Every 2 weeks",
  Monthly: "Every month",
};

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Same day next month, clamped to the target month's last day (Jan 31 → Feb 28).
function addMonthClampedUtc(date: Date): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const daysInTarget = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInTarget));
  return next;
}

function step(rule: RecurrenceRule, from: Date): Date {
  switch (rule) {
    case "Daily":
      return addDaysUtc(from, 1);
    case "Weekdays": {
      let next = addDaysUtc(from, 1);
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
        next = addDaysUtc(next, 1);
      }
      return next;
    }
    case "Weekly":
      return addDaysUtc(from, 7);
    case "Biweekly":
      return addDaysUtc(from, 14);
    case "Monthly":
      return addMonthClampedUtc(from);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

const FIXED_PERIOD_DAYS: Partial<Record<RecurrenceRule, number>> = {
  Daily: 1,
  Weekdays: 1,
  Weekly: 7,
  Biweekly: 14,
};

/**
 * Next occurrence after `from`, rolled forward until strictly after `now`
 * so a task completed late never spawns an already-overdue copy.
 * Keeps the time-of-day of `from`.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  from: Date,
  now: Date = new Date(),
): Date {
  let next = step(rule, from);
  if (next.getTime() <= now.getTime()) {
    // Fast-forward fixed-period rules arithmetically so an anchor years in
    // the past never exhausts the step loop (whole periods keep the anchor's
    // weekday/time; Monthly steps below instead — capped at ~83 years).
    const periodDays = FIXED_PERIOD_DAYS[rule];
    if (periodDays) {
      const periodsBehind = Math.floor(
        (now.getTime() - next.getTime()) / (periodDays * DAY_MS),
      );
      if (periodsBehind > 0) {
        next = addDaysUtc(next, periodsBehind * periodDays);
      }
    }
    for (let guard = 0; guard < 1000 && next.getTime() <= now.getTime(); guard++) {
      next = step(rule, next);
    }
  }
  if (rule === "Weekdays") {
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
      next = addDaysUtc(next, 1);
    }
  }
  return next;
}
