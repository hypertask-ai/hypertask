"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import type { ToggleSwitchProps } from "@/components/sidebars/RightSidebar/Single section items";

type SettingsToggleProps = ToggleSwitchProps & {
  hideLabel?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
};

const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  description,
  disabled = false,
  hideLabel = false,
  inputId,
  label,
  onChange,
  onKeyDown,
}) => {
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
        className="relative h-6 w-10 shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-container-outline disabled:cursor-not-allowed disabled:opacity-50"
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
            "absolute left-[3px] top-[3px] h-[18px] w-[34px] rounded-full border-[1px] border-border-light-gray-thin transition-colors",
            checked ? "bg-hypertasks-green" : "bg-hover-active"
          )}
        >
          <span
            className={cn(
              "absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-white transition-transform",
              checked && "translate-x-4"
            )}
          />
        </span>
      </button>
    </div>
  );
};

export default SettingsToggle;
