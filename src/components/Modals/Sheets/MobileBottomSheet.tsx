"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { cn } from "@/utils/undoActions/helperFuncs";
import { AppSheet, SheetScroller } from "./AppSheet";

interface MobileBottomSheetProps {
  isOpen?: boolean;
  onClose: () => void;
  children: ReactNode;
  bottomSlot?: ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  contentClassName?: string;
  bottomSlotClassName?: string;
  fullHeight?: boolean;
  keyboardAware?: boolean;
  zIndex?: number;
  onCloseEnd?: () => void;
}

const MOBILE_SHEET_MAX_HEIGHT_RATIO = 0.82;

/** Shared mobile sheet shape for command and navigation surfaces. */
export const MobileBottomSheet = ({
  isOpen = true,
  onClose,
  children,
  bottomSlot,
  ariaLabel = "Sheet",
  labelledBy,
  contentClassName,
  bottomSlotClassName,
  fullHeight = false,
  keyboardAware = false,
  zIndex = 10000,
  onCloseEnd,
}: MobileBottomSheetProps) => {
  const viewport = useMobileVisualViewport(isOpen);
  const keyboardOpen = keyboardAware && (viewport?.bottomInset ?? 0) > 0;
  const availableHeight = viewport?.visibleHeight ?? 0;
  const restingHeight = viewport
    ? Math.min(
        viewport.visibleHeight,
        viewport.layoutHeight * MOBILE_SHEET_MAX_HEIGHT_RATIO
      )
    : 0;
  const sheetHeight = keyboardOpen ? availableHeight : restingHeight;
  const containerStyle: CSSProperties = {
    bottom: keyboardAware ? viewport?.bottomInset ?? 0 : 0,
    maxHeight: sheetHeight > 0 ? `${sheetHeight}px` : "82svh",
    ...(fullHeight
      ? { height: sheetHeight > 0 ? `${sheetHeight}px` : "82svh" }
      : {}),
  };

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={ariaLabel}
      labelledBy={labelledBy}
      detent={fullHeight ? "full-height" : "content-height"}
      disableScrollLocking
      defaultLibraryHeader={false}
      zIndex={zIndex}
      onCloseEnd={onCloseEnd}
      panelClassName="!overflow-hidden !rounded-t-[5px] !border-0 !bg-modalBackground text-white-black shadow-customshadow-2"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden !bg-modalBackground"
      backdropClassName="bg-pageBackground opacity-60"
      headerClassName="!shrink-0 !bg-modalBackground !shadow-none"
      handleRowClassName="flex h-5 w-full shrink-0 items-center justify-center"
      handleBarClassName="h-1 w-9 rounded-full bg-label-span"
      containerStyle={containerStyle}
    >
      <SheetScroller
        draggableAt="top"
        className={cn("min-h-0 flex-1 overflow-y-auto no-scrollbar", contentClassName)}
      >
        {children}
      </SheetScroller>
      {bottomSlot ? (
        <div
          className={cn("shrink-0", bottomSlotClassName)}
          style={{
            paddingBottom: keyboardAware
              ? 0
              : "env(safe-area-inset-bottom)",
          }}
        >
          {bottomSlot}
        </div>
      ) : null}
    </AppSheet>
  );
};
