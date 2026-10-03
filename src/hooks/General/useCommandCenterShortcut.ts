import { useEffect } from "react";
import { isCommandCenterShortcut } from "@/lib/constants/commandCenterShortcut";

export function useCommandCenterShortcut(
  authenticatedUserId: number | null,
  isApple: boolean,
  pathname: string | null,
  showTrialModal: boolean,
  showEmailVerificationModal: boolean,
  toggleShowCommands: () => void,
) {
  useEffect(() => {
    const handleCommandCenterShortcut = (e: KeyboardEvent) => {
      if (authenticatedUserId === null) return;
      if (showTrialModal || showEmailVerificationModal) return;
      if (!isCommandCenterShortcut(e, isApple, pathname)) return;
      e.preventDefault();
      // Capture before route/input handlers so one keypress cannot toggle twice.
      e.stopImmediatePropagation();
      toggleShowCommands();
    };
    document.addEventListener("keydown", handleCommandCenterShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleCommandCenterShortcut, true);
  }, [
    authenticatedUserId,
    isApple,
    pathname,
    showTrialModal,
    showEmailVerificationModal,
    toggleShowCommands,
  ]);
}
