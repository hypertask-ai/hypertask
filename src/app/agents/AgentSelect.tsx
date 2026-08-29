"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs";

/**
 * The one dropdown used across the agents pages.
 *
 * Same shape as the Settings model pickers: `appearance-none` so the control
 * is ours rather than the platform's, with a chevron sitting over it.
 *
 * `color-scheme` is what fixes the open list. The browser draws that popup
 * itself and paints it light under a light scheme however the options are
 * styled, which is why the closed control looked right on a dark theme while
 * the list came up white.
 */
export default function AgentSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  className,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "[color-scheme:light] dark:[color-scheme:dark]",
          "w-full appearance-none rounded-[4px] bg-active-modal-element",
          "px-2 py-1 pr-7 leading-normal text-white-black",
          "outline-none border-none cursor-pointer transition-colors",
          "hover:bg-hoverCardBackground disabled:opacity-60",
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-light-gray"
        size={14}
        strokeWidth={1.75}
      />
    </div>
  );
}

/** Options carry the colours too: the popup list is drawn by the platform. */
export function AgentOption({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <option value={value} className="bg-cardBackground text-white-black">
      {children}
    </option>
  );
}
