export function parseTimeMinutes(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1440
    ? (value as number)
    : null;
}

export function manualEntryTimes(
  date: string,
  minutes: number,
  timezoneOffsetMinutes?: number
) {
  if (parseTimeMinutes(minutes) === null) {
    throw new RangeError("Minutes must be an integer from 1 to 1440");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError("Invalid date");
  }

  const validTimezoneOffset =
    Number.isInteger(timezoneOffsetMinutes) &&
    Math.abs(timezoneOffsetMinutes ?? 0) <= 14 * 60
      ? timezoneOffsetMinutes!
      : 0;
  const startedAt = new Date(
    new Date(`${date}T12:00:00.000Z`).getTime() + validTimezoneOffset * 60 * 1000
  );
  if (
    Number.isNaN(startedAt.getTime()) ||
    new Date(`${date}T12:00:00.000Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new RangeError("Invalid date");
  }
  const endedAt = new Date(startedAt.getTime() + minutes * 60 * 1000);

  return { startedAt, endedAt };
}
