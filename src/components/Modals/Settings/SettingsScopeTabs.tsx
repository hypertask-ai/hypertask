import type { ReactNode } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";

export function SettingsScopeTabs({
  tabs, activeId, onSelect, ariaLabel = "Settings scopes", className,
  buttonClassName, disabled = false,
}: {
  tabs: readonly { id: string; label: ReactNode; className?: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto", className)}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-selected={activeId === tab.id}
          disabled={disabled}
          className={cn(
            "shrink-0 rounded-[5px] px-3 py-1.5 text-content font-medium text-text-light-gray transition hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none",
            activeId === tab.id && "bg-active-modal-element text-white-black",
            buttonClassName,
            tab.className,
          )}
          onClick={() => onSelect(tab.id)}
          role="tab"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
