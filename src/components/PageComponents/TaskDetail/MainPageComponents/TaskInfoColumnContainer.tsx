import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { cn } from "@/utils/undoActions/helperFuncs";

const DESKTOP_CLASSES =
  "sticky flex flex-col gap-4 rounded-[4px] min-h-0 py-[10px] px-[16px] w-full max-w-[312px] min-w-[260px]  ml-2 @lg:ml-[16px] items-center font-medium";
const MOBILE_CLASSES =
  "py-2 rounded-sm px-2 w-full gap-3 flex flex-col items-center  overflow-x-auto";
const BASE_CLASSES = "bg-comment-description shadow-md text-content";

export interface TaskInfoColumnContainerProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  heightVariant?: "full" | "fit";
  mobileResponsive?: boolean;
  className?: string;
}

export const TaskInfoColumnContainer: React.FC<TaskInfoColumnContainerProps> = ({
  children,
  style,
  heightVariant = "full",
  mobileResponsive = true,
  className,
}) => {
  const _mbl = useContext(MobileViewContext);

  const desktopHeight = heightVariant === "fit" ? "h-fit" : "h-full";

  return (
    <div
      data-task-properties-rail
      style={style}
      className={cn(
        BASE_CLASSES,
        mobileResponsive && _mbl
          ? cn(taskDetailSpacing.mobile.taskInfoContainer, MOBILE_CLASSES)
          : cn(DESKTOP_CLASSES, desktopHeight),
        className
      )}
    >
      {children}
    </div>
  );
};
