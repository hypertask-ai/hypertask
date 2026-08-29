import type { DisplayDate } from "@/components/Modals/RemindMe/RemindMeComponent";
import createSugarDate from "sugar/date/create";

const useGetTimeOptions = () => {
  const getTimeAndDisplayString = () => {
    const now = new Date();
    const currentHour = now.getHours();

    let timeString;
    let displayString;

    if (currentHour >= 0 && currentHour < 9) {
      // Between 12AM-8:59AM
      timeString = "today at 9:00 AM";
      displayString = "Today";
    } else if (currentHour >= 9 && currentHour < 17) {
      // Between 9AM-4:59PM
      timeString = "today at 5:00 PM";
      displayString = "Today";
    }
    else if (currentHour >= 17 && currentHour < 21) {
      // Between 5PM-8:59PM
      timeString = "today at 9:00 PM";
      displayString = "Today";
    } else {
      // Between 9PM-11:59PM
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

  // Sugar can't attach a time-of-day to a numeric offset like "2 weeks from
  // now at 9am" (it parses to Invalid Date), so set 9:00 AM explicitly.
  const offsetAtNineAM = (sugarString: string) => {
    const d = new Date(createSugarDate(sugarString));
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };

  // Richer set for Remind Me, mirroring Superhuman's order (later today ->
  // tomorrow -> in 2 days -> next week -> in 2 weeks). Kept separate from
  // getDefaultOptions so the Due Date modal is unaffected.
  const getRemindMeOptions = (lastUsedReminder: DisplayDate | undefined) => {
    const { timeString, displayString } = getTimeAndDisplayString();
    // The daytime "Today" slot is really "later today"; keep "Tonight" as-is.
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
