export type ChatNavigationState = {
  sessionId?: string | null;
  scrollTop?: number;
  scrollAway?: boolean;
  open?: boolean;
};

export function chatNavigationKey(userId: number | undefined, boardId?: number, taskId?: number, fullScreen = false): string | null {
  if (!userId) return null;
  return `aiChat.navigation.${userId}.${fullScreen ? "fullscreen" : "docked"}.${boardId ?? "all"}.${taskId ?? "board"}`;
}

export function readChatNavigationState(key: string | null | undefined): ChatNavigationState {
  if (!key || typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
      scrollTop: typeof value.scrollTop === "number" && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 ? value.scrollTop : undefined,
      scrollAway: typeof value.scrollAway === "boolean" ? value.scrollAway : undefined,
      open: typeof value.open === "boolean" ? value.open : undefined,
    };
  } catch {
    return {};
  }
}

export function writeChatNavigationState(key: string | null | undefined, state: ChatNavigationState): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...readChatNavigationState(key), ...state }));
  } catch {
  }
}
