import React, { useEffect, useState } from "react";
import { Sheet, useScrollPosition } from "react-modal-sheet";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";

export const APP_SHEET_Z_INDEX = 9990;

type ScrollPosition = "top" | "bottom" | "middle" | undefined;

const SheetScrollerContext = React.createContext<{
  isOpen: boolean;
  onScrollPosition: (position: ScrollPosition) => void;
} | null>(null);

/** Use inside an `AppSheet` with `customScroller` for a fixed header or footer. */
export const SheetScroller = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => {
  const context = React.useContext(SheetScrollerContext);
  const onScrollPosition = context?.onScrollPosition;
  const { scrollRef, scrollPosition } = useScrollPosition({
    debounceDelay: 0,
    isEnabled: context?.isOpen ?? false,
  });

  useEffect(() => {
    onScrollPosition?.(scrollPosition);
  }, [onScrollPosition, scrollPosition]);

  useEffect(
    () => () => onScrollPosition?.(undefined),
    [onScrollPosition],
  );

  return (
    <div
      {...props}
      ref={scrollRef}
      className={cn("overflow-y-auto", className)}
    />
  );
};

type SheetDetent = "default" | "content" | "full";

type RootSheetProps = Pick<
  ComponentPropsWithoutRef<typeof Sheet>,
  "id" | "onClick" | "onCloseEnd" | "onOpenStart" | "onOpenEnd"
>;

export interface AppSheetProps extends RootSheetProps {
  isOpen?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  /** Optional id of visible title element (preferred over ariaLabel when set). */
  labelledBy?: string;
  showHandle?: boolean;
  /**
   * When true (default), `Sheet.Header` uses the library drag indicator.
   * When false with `showHandle`, use `handleRowClassName` + `handleBarClassName`.
   */
  defaultLibraryHeader?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
  customScroller?: boolean;
  backdropClassName?: string;
  /** Applied to `Sheet.Header` (library, custom, or collapsed). */
  headerClassName?: string;
  /** When `showHandle` and not `defaultLibraryHeader`: row wrapper around the pill. */
  handleRowClassName?: string;
  /** When `showHandle` and not `defaultLibraryHeader`: drag pill. */
  handleBarClassName?: string;
  /** When not `showHandle`: inner node inside `Sheet.Header`. */
  headerCollapsedInnerClassName?: string;
  zIndex?: number | string;
  detent?: SheetDetent;
  disableScrollLocking?: boolean;
  /** `className` on the root `Sheet` (portal wrapper). */
  sheetClassName?: string;
  /** Merged after `zIndex` unless `zIndex` is overridden here. */
  sheetStyle?: React.CSSProperties;
  /** Passed to `Sheet.Container`. */
  containerStyle?: React.CSSProperties;
}

export const AppSheet: React.FC<AppSheetProps> = ({
  isOpen = true,
  onClose,
  children,
  ariaLabel = "Sheet",
  labelledBy,
  showHandle = true,
  defaultLibraryHeader = true,
  panelClassName,
  bodyClassName,
  customScroller = false,
  backdropClassName,
  headerClassName,
  handleRowClassName,
  handleBarClassName,
  headerCollapsedInnerClassName,
  zIndex = APP_SHEET_Z_INDEX,
  detent = "content",
  disableScrollLocking = false,
  sheetClassName,
  sheetStyle,
  containerStyle,
  id,
  onClick,
  onCloseEnd,
  onOpenStart,
  onOpenEnd,
}) => {
  const [customScrollPosition, setCustomScrollPosition] =
    useState<ScrollPosition>();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const headerEl = !showHandle ? (
    <Sheet.Header disableDrag className={cn(headerClassName)}>
      <div className={cn(headerCollapsedInnerClassName)} aria-hidden />
    </Sheet.Header>
  ) : defaultLibraryHeader ? (
    <Sheet.Header className={cn(headerClassName)} />
  ) : (
    <Sheet.Header className={cn(headerClassName)}>
      <div className={cn(handleRowClassName)}>
        <div className={cn(handleBarClassName)} aria-hidden />
      </div>
    </Sheet.Header>
  );

  return (
    <Sheet
      id={id}
      isOpen={isOpen}
      onClose={onClose}
      detent={detent}
      avoidKeyboard={false}
      disableScrollLocking={disableScrollLocking}
      className={cn(sheetClassName)}
      style={{ zIndex, ...sheetStyle }}
      role="dialog"
      aria-modal
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      onClick={onClick}
      onCloseEnd={onCloseEnd}
      onOpenStart={onOpenStart}
      onOpenEnd={onOpenEnd}
    >
      <SheetScrollerContext.Provider
        value={{ isOpen, onScrollPosition: setCustomScrollPosition }}
      >
        <Sheet.Container
          className={cn(panelClassName)}
          style={containerStyle}
        >
          {headerEl}
          <Sheet.Content
            disableScroll={customScroller}
            disableDrag={
              customScroller &&
              customScrollPosition !== undefined &&
              customScrollPosition !== "top"
            }
            scrollClassName={cn(bodyClassName)}
          >
            {children}
          </Sheet.Content>
        </Sheet.Container>
      </SheetScrollerContext.Provider>
      <Sheet.Backdrop
        className={cn(backdropClassName)}
        onTap={(event) => {
          event.stopPropagation();
          onClose();
        }}
      />
    </Sheet>
  );
};
