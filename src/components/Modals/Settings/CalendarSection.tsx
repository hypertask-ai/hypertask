"use client";

import { useRecoilState } from "@/lib/state";
import { calendarSettingsAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const WEEK_START_OPTIONS = ["monday", "sunday"] as const;

const CalendarSection = () => {
  const [settings, setSettings] = useRecoilState(calendarSettingsAtom);

  return (
    <SettingsSectionShell title="Calendar">
      <SettingsCard title="Calendar">
        <div className="flex min-h-[36px] items-center justify-between gap-3 px-2 py-1">
          <span className="text-dense font-semibold text-white-black">
            Week starts on
          </span>
          <div
            aria-label="Week starts on"
            className="flex shrink-0 overflow-hidden rounded-[4px] bg-cardBackground p-0.5"
            role="group"
          >
            {WEEK_START_OPTIONS.map((day) => (
              <button
                key={day}
                aria-pressed={settings.weekStartsOn === day}
                className={cn(
                  "rounded-[4px] px-3 py-1.5 text-dense font-medium capitalize text-white-black outline-none transition hover:bg-hover-active focus-visible:bg-hover-active",
                  settings.weekStartsOn === day && "bg-active-modal-element",
                )}
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    weekStartsOn: day,
                  }))
                }
                type="button"
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <SettingsToggle
          checked={settings.showWeekends}
          inputId="calendar-show-weekends"
          label="Show weekends"
          onChange={() =>
            setSettings((current) => ({
              ...current,
              showWeekends: !current.showWeekends,
            }))
          }
          value={settings.showWeekends}
        />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default CalendarSection;
