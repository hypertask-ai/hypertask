import { HTPR_8054_GRAPHITE_2_FLAG } from "@/lib/flags/definitions/htpr-8054-graphite-2";
import { useFlag } from "@/hooks/useFlag";
import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";

export interface TaskInfoLabelProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const TaskInfoLabel: React.FC<TaskInfoLabelProps> = ({
  children,
  className,
  onClick,
}) => {
  const _mbl = useContext(MobileViewContext);
  const graphite2Enabled = useFlag(HTPR_8054_GRAPHITE_2_FLAG);

  return (
    <span
      data-task-property-label={graphite2Enabled ? true : undefined}
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
