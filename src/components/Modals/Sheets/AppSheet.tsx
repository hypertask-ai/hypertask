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
  aboveSlot?: React.ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  showHandle?: boolean;
  defaultLibraryHeader?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
  customScroller?: boolean;
  backdropClassName?: string;
  headerClassName?: string;
  handleRowClassName?: string;
  handleBarClassName?: string;
  headerCollapsedInnerClassName?: string;
  zIndex?: number | string;
  detent?: SheetDetent;
  disableScrollLocking?: boolean;
  sheetClassName?: string;
  sheetStyle?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
}

export const AppSheet: React.FC<AppSheetProps> = ({
  isOpen = true,
  onClose,
  children,
  aboveSlot,
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
          {aboveSlot}
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
