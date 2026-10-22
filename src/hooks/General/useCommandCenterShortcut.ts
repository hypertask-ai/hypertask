import { useEffect } from "react";
import { isCommandCenterShortcut, isComposePaletteShortcut } from "@/lib/constants/commandCenterShortcut";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_7547_SEARCH_LAZY_CLOSED_FLAG, HTPR_7571_INBOX_CTRLK_CLOSE_FLAG } from "@/lib/flags/keys";
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
  const lazyClosedSearchCommands = useFlag(HTPR_7547_SEARCH_LAZY_CLOSED_FLAG);
  const inboxCtrlKClose = useFlag(HTPR_7571_INBOX_CTRLK_CLOSE_FLAG);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  useEffect(() => {
    const handleCommandCenterShortcut = (e: KeyboardEvent) => {
      if (authenticatedUserId === null) return;
      if (showTrialModal || showEmailVerificationModal) return;
      if (composeEnabled && isComposePaletteShortcut(e, isApple, pathname)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const fromPendingSearchProxy = lazyClosedSearchCommands && pathname === "/search" && e.code === "KeyK" &&
          (e.target as HTMLElement | null)?.id === "search-command-focus-proxy";
        const fromPendingInboxProxy = inboxCtrlKClose && pathname === "/inbox" && e.code === "KeyK" &&
          (e.target as HTMLElement | null)?.id === "inbox-command-focus-proxy";
        if (fromPendingSearchProxy || fromPendingInboxProxy) {
          setShowCommands((prev) => prev.paletteTab === "search"
            ? { ...prev, show: false }
            : { show: true, mode: CommandMode.Command, paletteTab: "search" });
          return;
        }
        setShowCommands({ show: true, mode: CommandMode.Command, paletteTab: e.code === "KeyJ" ? "compose" : "search" });
        return;
      }
      if (!isCommandCenterShortcut(e, isApple, pathname)) return;
      e.preventDefault();
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
    lazyClosedSearchCommands,
    inboxCtrlKClose,
    setShowCommands,
  ]);
}
