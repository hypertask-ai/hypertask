import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";

export interface TaskInfoLabelProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * Static label for task info rows (no click/tooltip).
 * Use TaskInfoLabel for read-only labels; use LocalRightSideInfo for interactive labels.
 */
export const TaskInfoLabel: React.FC<TaskInfoLabelProps> = ({
  children,
  className,
  onClick,
}) => {
  const _mbl = useContext(MobileViewContext);

  return (
    <span
      onClick={onClick}
      className={cn(
        _mbl ? "w-[88px] shrink-0 text-meta" : "w-[25%] @sm:w-1/2",
        "text-[#8E9093] font-medium",
        className
      )}
    >
      {children}
    </span>
  );
};
