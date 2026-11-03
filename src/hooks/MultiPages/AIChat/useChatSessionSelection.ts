import { useCallback, useState, type SetStateAction } from "react";
import { readChatNavigationState, writeChatNavigationState } from "@/lib/aiChat/chatNavigationState";

export function useChatSessionSelection(identity: string, navigationKey?: string | null, restoreSelection = true, pinnedId: string | null = null) {
  const [selection, setSelection] = useState({ identity, navigationKey, id: pinnedId ?? (restoreSelection ? readChatNavigationState(navigationKey).sessionId ?? null : null) });
  const resumedId = () => pinnedId ?? (!restoreSelection || selection.navigationKey === navigationKey ? null : readChatNavigationState(navigationKey).sessionId ?? null);
  const activeSession = selection.identity === identity ? selection.id : resumedId();
  const setActiveSession = useCallback((next: SetStateAction<string | null>) => {
    setSelection((previous) => {
      const selected = previous.identity === identity ? previous.id : pinnedId ?? (!restoreSelection || previous.navigationKey === navigationKey ? null : readChatNavigationState(navigationKey).sessionId ?? null);
      const id = typeof next === "function" ? next(selected) : next;
      writeChatNavigationState(navigationKey, { sessionId: id });
      return previous.identity === identity && previous.id === id ? previous : { identity, navigationKey, id };
    });
  }, [identity, navigationKey, restoreSelection, pinnedId]);
  return [activeSession, setActiveSession] as const;
}
