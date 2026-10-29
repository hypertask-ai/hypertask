import { useCallback, useState, type SetStateAction } from "react";
import { readChatNavigationState, writeChatNavigationState } from "@/lib/aiChat/chatNavigationState";

export function useChatSessionSelection(identity: string, navigationKey?: string | null) {
  const [selection, setSelection] = useState({ identity, navigationKey, id: readChatNavigationState(navigationKey).sessionId ?? null });
  const activeSession = selection.identity === identity ? selection.id : selection.navigationKey === navigationKey ? null : readChatNavigationState(navigationKey).sessionId ?? null;
  const setActiveSession = useCallback((next: SetStateAction<string | null>) => {
    setSelection((previous) => {
      const selected = previous.identity === identity ? previous.id : previous.navigationKey === navigationKey ? null : readChatNavigationState(navigationKey).sessionId ?? null;
      const id = typeof next === "function" ? next(selected) : next;
      writeChatNavigationState(navigationKey, { sessionId: id });
      return previous.identity === identity && previous.id === id ? previous : { identity, navigationKey, id };
    });
  }, [identity, navigationKey]);
  return [activeSession, setActiveSession] as const;
}
