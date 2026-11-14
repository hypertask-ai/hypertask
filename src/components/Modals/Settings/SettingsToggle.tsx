"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import type { ToggleSwitchProps } from "@/components/sidebars/RightSidebar/Single section items";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9027_AMOLED_TOGGLE_FLAG } from "@/lib/flags/definitions/htpr-9027-amoled-toggle";

type SettingsToggleProps = ToggleSwitchProps & {
  hideLabel?: boolean;
  square?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
};

const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  description,
  disabled = false,
  hideLabel = false,
  square = false,
  inputId,
  label,
  onChange,
  onKeyDown,
}) => {
  const amoledToggle = useFlag(HTPR_9027_AMOLED_TOGGLE_FLAG);
  return (
    <div className="flex min-h-[28px] items-center justify-between gap-4 px-2 py-1">
      <label
        className={cn(
          "text-dense font-semibold text-white-black",
          hideLabel && "sr-only"
        )}
        htmlFor={inputId}
      >
        <span className="block">{label}</span>
        {description ? (
          <span className="block text-[12px] font-normal text-text-light-gray">
            {description}
          </span>
        ) : null}
      </label>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative h-6 w-10 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-container-outline disabled:cursor-not-allowed disabled:opacity-50",
          square ? "rounded-[4px]" : "rounded-full"
        )}
        disabled={disabled}
        id={inputId}
        onClick={onChange}
        onKeyDown={onKeyDown}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-[3px] top-[3px] h-[18px] w-[34px] border-[1px] border-border-light-gray-thin transition-colors",
            square ? "rounded-[4px]" : "rounded-full",
            checked ? "bg-hypertasks-green" : "bg-hover-active",
            amoledToggle && checked && "[.amoled_&]:bg-shadcn-primary"
          )}
        >
          <span
            className={cn(
              "absolute left-[2px] top-[2px] h-3 w-3 bg-white transition-transform",
              square ? "rounded-[2px]" : "rounded-full",
              checked && "translate-x-4"
            )}
          />
        </span>
      </button>
    </div>
  );
};

export default SettingsToggle;
