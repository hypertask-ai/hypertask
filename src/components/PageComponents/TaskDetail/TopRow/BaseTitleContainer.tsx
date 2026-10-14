import React, { ReactNode } from 'react';
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";

interface BaseTitleContainerProps {
  dataAttribute: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  containerClassName?: string;
  titleRowClassName?: string;
  showScrollShadow?: boolean;
  hasSummary?: boolean;
  titleRowContent: ReactNode;
  children?: ReactNode;
  zIndex?: number;
  useHorizontalPadding?: boolean;
}

const BaseTitleContainer: React.FC<BaseTitleContainerProps> = ({
  dataAttribute,
  containerRef,
  containerClassName,
  titleRowClassName,
  showScrollShadow = false,
  hasSummary,
  titleRowContent,
  children,
  zIndex = 50,
  useHorizontalPadding = true,
}) => {
  const _mbl = useContext(MobileViewContext);

  const baseContainerClasses = cn(
    "flex flex-col sm:sticky text-white-black top-0 bg-inherit w-[100%] ",
    useHorizontalPadding && "task-detail-horizontal-title-container",
    _mbl
      ?
        cn(
          "items-start sticky top-[env(safe-area-inset-top)] border-b border-light-black-border-1",
          dataAttribute === "task-detail" ? "pt-2" : "pt-4"
        )
      : "pt-9 items-baseline pb-[8px]",
    _mbl && dataAttribute === "task-detail" && "task-detail-title-safe-fill",
    !hasSummary && "pb-3",
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

