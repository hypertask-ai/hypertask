"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMobileVisualViewport } from "@/hooks/General/useMobileVisualViewport";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG } from "@/lib/flags/keys";
import { AppSheet, SheetScroller } from "./AppSheet";

interface MobileBottomSheetProps {
  isOpen?: boolean;
  onClose: () => void;
  children: ReactNode;
  aboveSlot?: ReactNode;
  bottomSlot?: ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  contentClassName?: string;
  bottomSlotClassName?: string;
  bottomSafeAreaFloor?: boolean;
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
  aboveSlot: requestedAboveSlot,
  bottomSlot,
  ariaLabel = "Sheet",
  labelledBy,
  contentClassName,
  bottomSlotClassName,
  bottomSafeAreaFloor = false,
  fullHeight = false,
  keyboardAware = false,
  zIndex = 10000,
  onCloseEnd,
}: MobileBottomSheetProps) => {
  const composeTaskWriterEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const aboveSlot = composeTaskWriterEnabled ? requestedAboveSlot : undefined;
  const viewport = useMobileVisualViewport(isOpen);
  const keyboardOpen = keyboardAware && (viewport?.bottomInset ?? 0) > 0;
  const availableHeight = viewport?.visibleHeight ?? 0;
  const restingHeight = viewport
    ? Math.min(
        viewport.visibleHeight,
        viewport.layoutHeight * MOBILE_SHEET_MAX_HEIGHT_RATIO
      )
    : 0;
  // Leave room for controls above the sheet when the keyboard fills the viewport.
  const sheetHeight = keyboardOpen
    ? Math.max(0, availableHeight - (aboveSlot ? 48 : 0))
    : restingHeight;
  const containerStyle: CSSProperties = {
    bottom: keyboardAware ? viewport?.bottomInset ?? 0 : 0,
    maxHeight: sheetHeight > 0 ? `${sheetHeight}px` : "82svh",
    ...(fullHeight
      ? { height: sheetHeight > 0 ? `${sheetHeight}px` : "82svh" }
      : {}),
  };
  let bottomSlotPadding: CSSProperties["paddingBottom"] = keyboardAware
    ? 0
    : "env(safe-area-inset-bottom)";
  if (bottomSafeAreaFloor) {
    bottomSlotPadding = "max(0.75rem, env(safe-area-inset-bottom))";
  }
  if (keyboardOpen) bottomSlotPadding = 0;

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={ariaLabel}
      labelledBy={labelledBy}
      detent={fullHeight ? "default" : "content"}
      disableScrollLocking
      customScroller
      defaultLibraryHeader={false}
      zIndex={zIndex}
      onCloseEnd={onCloseEnd}
      aboveSlot={composeTaskWriterEnabled ? requestedAboveSlot : undefined}
      panelClassName={cn("!overflow-hidden !rounded-t-[5px] !border-0 !bg-modalBackground text-white-black shadow-customshadow-2", aboveSlot && "!overflow-visible")}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden !bg-modalBackground"
      backdropClassName="bg-pageBackground opacity-60"
      headerClassName="!shrink-0 !bg-modalBackground !shadow-none"
      handleRowClassName="flex h-5 w-full shrink-0 items-center justify-center"
      handleBarClassName="h-1 w-9 rounded-full bg-label-span"
      containerStyle={containerStyle}
    >
      <SheetScroller
        className={cn("min-h-0 flex-1 overflow-y-auto no-scrollbar", contentClassName)}
      >
        {children}
      </SheetScroller>
      {bottomSlot ? (
        <div
          className={cn("shrink-0", bottomSlotClassName)}
          style={{ paddingBottom: bottomSlotPadding }}
        >
          {bottomSlot}
        </div>
      ) : null}
    </AppSheet>
  );
};
