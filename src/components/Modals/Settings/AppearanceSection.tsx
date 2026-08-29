"use client";

import { Check } from "lucide-react";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { themeOptions } from "@/lib/themePreferences";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";

const AppearanceThemePicker = () => {
  const { currentTheme, switchToTheme } = useDarkMode();
  const activeTheme = currentTheme ?? "system";

  return (
    <div className="flex flex-col gap-1">
      {themeOptions.map((option) => {
        const isActive = activeTheme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 text-left text-dense font-medium text-white-black outline-none transition hover:bg-hover-active focus-visible:bg-hover-active",
              isActive && "bg-active-modal-element"
            )}
            onClick={() => switchToTheme(option.value)}
          >
            <span>{option.title}</span>
            {isActive && <Check strokeWidth={1.75} size={14} />}
          </button>
        );
      })}
    </div>
  );
};

const AppearanceSection = () => (
  <SettingsSectionShell title="Appearance">
    <SettingsCard title="Appearance">
      <AppearanceThemePicker />
    </SettingsCard>
  </SettingsSectionShell>
);

export default AppearanceSection;
