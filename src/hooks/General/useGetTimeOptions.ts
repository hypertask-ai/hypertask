import type { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import createSugarDate from "sugar/date/create";

const useGetTimeOptions = () => {
  const getTimeAndDisplayString = () => {
    const now = new Date();
    const currentHour = now.getHours();

    let timeString;
    let displayString;

    if (currentHour >= 0 && currentHour < 9) {
      timeString = "today at 9:00 AM";
      displayString = "Today";
    } else if (currentHour >= 9 && currentHour < 17) {
      timeString = "today at 5:00 PM";
      displayString = "Today";
    }
    else if (currentHour >= 17 && currentHour < 21) {
      timeString = "today at 9:00 PM";
      displayString = "Today";
    } else {
      timeString = "tomorrow at 12:00 AM";
      displayString = "Tonight";
    }

    return { timeString, displayString };
  };

  const getDefaultOptions = () => {
    const { timeString, displayString } = getTimeAndDisplayString();
    return [
      {
        display: displayString,
        date: createSugarDate(timeString).toISOString(),
        default: true,
      },
      {
        display: "Tomorrow",
        date: createSugarDate("Tomorrow at 9:00 AM").toISOString(),
        default: true,
      },
      {
        display: "Next week monday",
        date: createSugarDate("Next week Monday at 9:00 AM").toISOString(),
        default: true,
      },
    ];
  };

  const getDueDateOptions = (isActive: Date | undefined, lastUsedDueDate?: DisplayDate) =>
    [
      isActive ? { display: "Reset", date: undefined } : null,
      lastUsedDueDate ?? null,
      ...getDefaultOptions(),
      {
        display: "Pick a custom date",
        date: undefined,
      },
    ].filter(Boolean);

  const offsetAtNineAM = (sugarString: string) => {
    const d = new Date(createSugarDate(sugarString));
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };

  const getRemindMeOptions = (lastUsedReminder: DisplayDate | undefined) => {
    const { timeString, displayString } = getTimeAndDisplayString();
    const laterTodayDisplay = displayString === "Today" ? "Later today" : displayString;

    return [
      ...(lastUsedReminder ? [lastUsedReminder] : []),
      {
        display: laterTodayDisplay,
        date: createSugarDate(timeString).toISOString(),
        default: true,
      },
      {
        display: "Tomorrow",
        date: createSugarDate("Tomorrow at 9:00 AM").toISOString(),
        default: true,
      },
      {
        display: "In 2 days",
        date: createSugarDate("The day after tomorrow at 9:00 AM").toISOString(),
        default: true,
      },
      {
        display: "Next week monday",
        date: createSugarDate("Next week Monday at 9:00 AM").toISOString(),
        default: true,
      },
      {
        display: "In 2 weeks",
        date: offsetAtNineAM("2 weeks from now"),
        default: true,
      },
    ].filter(Boolean);
  };

  return { getDueDateOptions, getRemindMeOptions, getDefaultOptions };
};

export default useGetTimeOptions;
