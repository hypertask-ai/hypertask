import { addDays, startOfWeek } from "date-fns";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const getCalendarTitle = ({
  currentView,
  currentDate,
  today,
  weekStartsOn,
}: {
  currentView: "day" | "week" | "month";
  currentDate: Date;
  today: Date;
  weekStartsOn: 0 | 1;
}) => {
  const currentYear = today.getFullYear();

  if (currentView === "month") {
    const month = MONTHS[currentDate.getMonth()];
    return currentDate.getFullYear() === currentYear
      ? month
      : `${month} ${currentDate.getFullYear()}`;
  }

  if (currentView === "day") {
    const title = `${SHORT_DAYS[currentDate.getDay()]}, ${
      SHORT_MONTHS[currentDate.getMonth()]
    } ${currentDate.getDate()}`;
    return currentDate.getFullYear() === currentYear
      ? title
      : `${title}, ${currentDate.getFullYear()}`;
  }

  const weekStart = startOfWeek(currentDate, { weekStartsOn });
  const weekEnd = addDays(weekStart, 6);
  const sameMonth =
    weekStart.getMonth() === weekEnd.getMonth() &&
    weekStart.getFullYear() === weekEnd.getFullYear();
  const range =
    sameMonth
      ? `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getDate()}`
      : `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${
          SHORT_MONTHS[weekEnd.getMonth()]
        } ${weekEnd.getDate()}`;
  const isCurrentYear =
    weekStart.getFullYear() === currentYear &&
    weekEnd.getFullYear() === currentYear;

  return isCurrentYear ? range : `${range}, ${weekEnd.getFullYear()}`;
};
