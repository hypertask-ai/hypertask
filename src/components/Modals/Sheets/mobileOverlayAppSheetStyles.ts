import { cn } from "@/utils/undoActions/helperFuncs";

/** Below the mobile tab bar (z-300); matches mobile AI chat overlay stacking. */
export const MOBILE_OVERLAY_SHEET_Z = 280;

/** Shared bottom-sheet panel styling for mobile AI overlays (chat, refine, etc.). */
export const mobileOverlayAppSheetPanelClass = cn(
  "!bg-ai-chat text-white-black p-0 shadow-[0_-12px_40px_rgba(0,0,0,0.45)]",
  "rounded-t-2xl border-t border-border-light-gray-thin",
  "border-thin border-border-light-gray-thin",
  "!max-h-[85svh] h-[85svh]",
);

export const mobileOverlayAppSheetBodyClass = cn(
  "flex min-h-0 flex-1 flex-col overflow-hidden p-0",
  "pb-[env(safe-area-inset-bottom)]",
);

export const mobileOverlayAppSheetHandleHeaderClass =
  "!shadow-none !bg-transparent shrink-0";
export const mobileOverlayAppSheetHandleRowClass =
  "flex w-full shrink-0 flex-col items-center pt-2 pb-1";
export const mobileOverlayAppSheetHandleBarClass =
  "h-1 w-10 rounded-full bg-white-black/25";

/** Darker typing well — sits above the keyboard at the bottom of the sheet. */
export const mobileOverlayAppSheetEditorWellClass = cn(
  "mx-2 flex-shrink-0 overflow-y-auto rounded-lg border border-thin border-border-light-gray-thin",
  "bg-newcomment-well px-3 py-2 text-content",
  "min-h-[120px]",
);
