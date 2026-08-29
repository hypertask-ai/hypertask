"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import { Check } from "lucide-react";

interface ColoredCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  color: string; // The color hex value to use when checked
  className?: string;
  id: string;
}

//This was a pain to make. Checkbox CSS is a pain. 
export const ColoredCheckbox = ({
  checked,
  onChange,
  color,
  className,
  id,
}: ColoredCheckboxProps) => {
  // Always set both backgroundColor and borderColor explicitly
  const style: React.CSSProperties = {
    borderWidth: "1px",
    borderStyle: "solid",
    ...(checked
      ? {
          backgroundColor: color,
          borderColor: color,
        }
      : {
          backgroundColor: "var(--bg-sidebar)",
          borderColor: "var(--border-white-black)", // More visible border for unchecked state
        }),
  };

  return (
    <div
      className={cn(
        `w-[14px] h-[14px] rounded-sm cursor-pointer transition-colors flex items-center justify-center focus:w-[16px] focus:h-[16px] focus:border-white-black`,
        className
      )}
      style={style}
      onClick={() => onChange(!checked)}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      id={id}
    >
      {checked && (
        <Check
          size={10}
          className="text-[var(--bg-sidebar)]"
          strokeWidth={1.75}
        />
      )}
    </div>
  );
};
