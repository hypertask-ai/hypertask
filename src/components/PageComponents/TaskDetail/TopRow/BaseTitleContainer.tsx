import React, { ReactNode } from 'react';
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8955_CHAT_OVER_TITLE_FLAG } from "@/lib/flags/definitions/htpr-8955-chat-over-title";
import { HTPR_8992_STICKY_TITLE_FLAG } from "@/lib/flags/definitions/htpr-8992-sticky-title";

interface BaseTitleContainerProps {
  dataAttribute: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  containerClassName?: string;
  titleRowClassName?: string;
  showScrollDivider?: boolean;
  hasSummary?: boolean;
  titleRowContent: ReactNode;
  children?: ReactNode;
  zIndex?: number | string;
  useHorizontalPadding?: boolean;
  clearDesktopNavigation?: boolean;
}

const BaseTitleContainer: React.FC<BaseTitleContainerProps> = ({
  dataAttribute,
  containerRef,
  containerClassName,
  titleRowClassName,
  showScrollDivider = false,
  hasSummary,
  titleRowContent,
  children,
  zIndex: zIndexOverride,
  useHorizontalPadding = true,
  clearDesktopNavigation = false,
}) => {
  const _mbl = useContext(MobileViewContext);
  const chatOverTitle = useFlag(HTPR_8955_CHAT_OVER_TITLE_FLAG);
  const stickyTitleLine = useFlag(HTPR_8992_STICKY_TITLE_FLAG);
  const zIndex = zIndexOverride ?? (chatOverTitle ? "var(--z-sticky)" : 50);

  const baseContainerClasses = cn(
    "flex flex-col sm:sticky text-white-black top-0 bg-inherit w-[100%] ",
    useHorizontalPadding && (clearDesktopNavigation ? "@xs:pl-[5.125rem] @xs:pr-[18px] @sm:pr-16" : "task-detail-horizontal-title-container"),
    _mbl
      ?
        cn(
          "items-start sticky top-[env(safe-area-inset-top)] border-b",
          stickyTitleLine && dataAttribute === "task-detail" ? "border-border-light-gray-thin" : "border-light-black-border-1",
          dataAttribute === "task-detail" ? "pt-2" : "pt-4"
        )
      : "pt-9 items-baseline pb-[8px]",
    _mbl && dataAttribute === "task-detail" && "task-detail-title-safe-fill",
    !hasSummary && "pb-3",
    stickyTitleLine && !_mbl && showScrollDivider && "shadow-[0_1px_0_0_var(--border-light-gray-thin)]",
    containerClassName
  );

  const baseTitleRowClasses = cn(
    "flex xs:px-0 xs:mx-0 justify-between w-full gap-2 items-center",
    hasSummary ? "xs:pb-2" : "xs:pb-0",
    titleRowClassName
  );

  return (
    <div
      data-title-container={dataAttribute}
      ref={containerRef}
      className={baseContainerClasses}
      style={{ zIndex }}
    >
      <div className={baseTitleRowClasses}>
        {titleRowContent}
      </div>
      
      {children}
    </div>
  );
};

export default BaseTitleContainer;

