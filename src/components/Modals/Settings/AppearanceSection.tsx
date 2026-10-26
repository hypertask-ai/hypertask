"use client";
import { HTPR_8054_GRAPHITE_2_FLAG } from "@/lib/flags/definitions/htpr-8054-graphite-2";

import { useFlag } from "@/hooks/useFlag";
import { useMobileView } from "@/lib/contexts/mobileContext";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/keys";
import { Check } from "lucide-react";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import { themeOptions } from "@/lib/themePreferences";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";

const AppearanceThemePicker = ({ options }: { options: readonly (typeof themeOptions)[number][] }) => {
  const { currentTheme, switchToTheme } = useDarkMode();
  const activeTheme = currentTheme ?? "system";

  return (
    <div className="flex flex-col gap-1">
      {options.map((option) => {
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

const AppearanceSection = () => {
  const roundedEnabled = useFlag(HTPR_7328_ROUNDED_THEME_FLAG);
  const graphite2Enabled = useFlag(HTPR_8054_GRAPHITE_2_FLAG);
  const isMobile = useMobileView();
  const options = roundedEnabled && !isMobile
    ? themeOptions
    : themeOptions.filter(({ value }) => value !== "rounded");

  return (
    <SettingsSectionShell title="Appearance">
      <SettingsCard title="Appearance">
        <AppearanceThemePicker options={options.filter(({ value }) => value !== "graphite-2" || graphite2Enabled)} />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default AppearanceSection;
