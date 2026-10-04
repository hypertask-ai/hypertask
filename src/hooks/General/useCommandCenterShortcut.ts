import { useEffect } from "react";
import { isCommandCenterShortcut, isComposePaletteShortcut } from "@/lib/constants/commandCenterShortcut";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG } from "@/lib/flags/keys";
import { useSetRecoilState } from "@/lib/state";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";

export function useCommandCenterShortcut(
  authenticatedUserId: number | null,
  isApple: boolean,
  pathname: string | null,
  showTrialModal: boolean,
  showEmailVerificationModal: boolean,
  toggleShowCommands: () => void,
) {
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  useEffect(() => {
    const handleCommandCenterShortcut = (e: KeyboardEvent) => {
      if (authenticatedUserId === null) return;
      if (showTrialModal || showEmailVerificationModal) return;
      if (composeEnabled && isComposePaletteShortcut(e, isApple, pathname)) {
        e.preventDefault();
        // Supersede the legacy board Ctrl+J before its handler can create a task.
        e.stopImmediatePropagation();
        setShowCommands({ show: true, mode: CommandMode.Command, paletteTab: e.code === "KeyJ" ? "compose" : "search" });
        return;
      }
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
    composeEnabled,
    setShowCommands,
  ]);
}
