const CALENDAR_DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const calendarDateKeyFromInstant = (instant: Date) =>
  instant.toISOString().slice(0, 10);

export const calendarDateFromKey = (dateKey: string) => {
  const match = CALENDAR_DATE_KEY.exec(dateKey);
  if (!match) throw new Error("Invalid calendar date key");

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    throw new Error("Invalid calendar date key");
  }
  return date;
};

export const initialCalendarDates = (dateKey: string) => ({
  currentDate: calendarDateFromKey(dateKey),
  currentDay: calendarDateFromKey(dateKey),
  today: calendarDateFromKey(dateKey),
});
