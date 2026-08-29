import React, { ReactNode } from 'react';
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";

interface BaseTitleContainerProps {
  /** Data attribute identifier for this container variant */
  dataAttribute: string;
  /** Ref to attach to the container (for sticky height calculations) */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Additional classes for the outer container */
  containerClassName?: string;
  /** Additional classes for the inner title row */
  titleRowClassName?: string;
  /** Whether to show scroll shadow effect */
  showScrollShadow?: boolean;
  /** Whether the task has a summary (affects padding) */
  hasSummary?: boolean;
  /** Content to render inside the title row */
  titleRowContent: ReactNode;
  /** Content to render after the title row (summary, subtask link, etc.) */
  children?: ReactNode;
  /** Custom z-index (default: 50) */
  zIndex?: number;
  /** Whether to use horizontal padding (default: true) */
  useHorizontalPadding?: boolean;
}

/**
 * Base title container component that centralizes the common structure
 * used across TaskDetailTitleContainer, SharedTaskTitleContainer, and TaskHeadingContainer.
 * 
 * TaskDetailTitleContainer is the standard/reference implementation.
 */
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

  // Base classes from TaskDetailTitleContainer (the standard)
  const baseContainerClasses = cn(
    "flex flex-col sm:sticky text-white-black top-0 bg-inherit w-[100%] ",
    useHorizontalPadding && "task-detail-horizontal-title-container",
    _mbl
      ? // Stick BELOW the status-bar inset (not top-0 with inset padding): when the
        // mobile top bar collapses on scroll the title pins just under the status
        // bar, no clash. env() is 0 in a normal browser, so this is top-0 there.
        cn(
          "items-start sticky top-[env(safe-area-inset-top)] border-b border-light-black-border-1",
          // Task-detail headline sits tight under the fixed top bar — the shell
          // already reserves 8px of breathing room in --mobile-top-bar-h, so
          // pt-2 keeps ~16px total above the title instead of a roomy 24px.
          // Shared-task / onboarding titles have no top bar above them, so they
          // keep the roomier pt-4.
          dataAttribute === "task-detail" ? "pt-2" : "pt-4"
        )
      : "pt-9 items-baseline pb-[8px]",
    // Mobile only, task-detail page only: fill the status-bar-inset strip above
    // the title (which pins at top: env(safe-area-inset-top)) so scrolling
    // comments don't show through it. See globals.scss. Scoped to this variant so
    // the shared-task / onboarding titles are untouched.
    _mbl && dataAttribute === "task-detail" && "task-detail-title-safe-fill",
    !hasSummary && "pb-3",
    // showScrollShadow && "relative after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-2 after:bg-gradient-to-b after:from-black/5 after:to-transparent after:pointer-events-none",
    containerClassName
  );

  // Base classes for title row from TaskDetailTitleContainer (the standard)
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
      {/* --------------------------- TASK TITLE ROW ----------------------------- */}
      <div className={baseTitleRowClasses}>
        {titleRowContent}
      </div>
      
      {/* --------------------------- ADDITIONAL CONTENT (Summary, Subtask Link, etc.) --------------------------- */}
      {children}
    </div>
  );
};

export default BaseTitleContainer;

