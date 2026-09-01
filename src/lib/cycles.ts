export const CYCLE_LENGTH_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CycleSummary {
  id: number;
  number: number;
  projectId: number;
  startDate: Date | string;
  endDate: Date | string;
  rolledOverAt?: Date | string | null;
}

export const utcDate = (value: Date | string | number = new Date()): Date => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const addUtcDays = (value: Date | string, days: number): Date =>
  new Date(utcDate(value).getTime() + days * DAY_MS);

export const startOfUtcWeek = (value: Date | string | number = new Date()): Date => {
  const date = utcDate(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addUtcDays(date, -mondayOffset);
};

export const cycleEndFor = (startDate: Date | string): Date =>
  addUtcDays(startDate, CYCLE_LENGTH_DAYS);

export const dateOnly = (value: Date | string): string =>
  utcDate(value).toISOString().slice(0, 10);

export const containsUtcDate = (
  cycle: Pick<CycleSummary, "startDate" | "endDate">,
  value: Date | string | number = new Date(),
): boolean => {
  const timestamp = utcDate(value).getTime();
  return (
    utcDate(cycle.startDate).getTime() <= timestamp &&
    timestamp < utcDate(cycle.endDate).getTime()
  );
};

export const resolveCycleWindow = <T extends CycleSummary>(
  cycles: readonly T[],
  value: Date | string | number = new Date(),
): { current: T | null; next: T | null } => {
  const ordered = [...cycles].sort(
    (left, right) => utcDate(left.startDate).getTime() - utcDate(right.startDate).getTime(),
  );
  const current = ordered.find((cycle) => containsUtcDate(cycle, value)) ?? null;
  const next = current
    ? ordered.find((cycle) => dateOnly(cycle.startDate) === dateOnly(current.endDate)) ?? null
    : ordered.find((cycle) => utcDate(cycle.startDate).getTime() > utcDate(value).getTime()) ?? null;
  return { current, next };
};

export const cycleDaysLeft = (
  cycle: Pick<CycleSummary, "endDate">,
  value: Date | string | number = new Date(),
): number =>
  Math.max(0, Math.ceil((utcDate(cycle.endDate).getTime() - utcDate(value).getTime()) / DAY_MS) - 1);

export const cycleDateRange = (
  cycle: Pick<CycleSummary, "startDate" | "endDate">,
  locale?: string,
): string => {
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return `${formatter.format(utcDate(cycle.startDate))} to ${formatter.format(addUtcDays(cycle.endDate, -1))}`;
};
