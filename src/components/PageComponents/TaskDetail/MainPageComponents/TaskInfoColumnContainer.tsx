import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { cn } from "@/utils/undoActions/helperFuncs";

/** Main-column width via container queries (see @container on AI_Chat_Layout); not viewport vw. */
const DESKTOP_CLASSES =
  "sticky flex flex-col gap-4 rounded-[4px] min-h-0 py-[10px] px-[16px] w-full max-w-[312px] min-w-[260px]  ml-2 @lg:ml-[16px] items-center font-medium";
const MOBILE_CLASSES =
  "py-2 rounded-sm px-2 w-full gap-3 flex flex-col items-center  overflow-x-auto";
// text-content (14px) is the single font size for every property row; per-row
// overrides made some values render smaller than the rest (HTPR-5465).
const BASE_CLASSES = "bg-comment-description shadow-md text-content";

export interface TaskInfoColumnContainerProps {
  children: React.ReactNode;
  /** Custom inline styles (e.g. top, fontFamily for sticky positioning) */
  style?: React.CSSProperties;
  /** "full" = h-full (task detail page), "fit" = h-fit (create modal) */
  heightVariant?: "full" | "fit";
  /** When false, always use desktop layout (e.g. onboarding) */
  mobileResponsive?: boolean;
  className?: string;
}

/**
 * Shared container for the task info column (assignees, priority, due date, etc.)
 * Used by TaskDetail, SharedTask, CreateTaskModal, and Onboarding.
 */
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
      // Stable hook for verifying the sticky rail (HTPR-5513).
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
