export const CHAT_OPEN_SESSION_KEY = "ht:aiChatOpen";

// sessionStorage is unavailable in some embedded/private contexts and can
// throw on access. Losing restore-on-reload is acceptable; blocking chat is not.
export function readChatOpenForSession(): boolean {
  try {
    return window.sessionStorage.getItem(CHAT_OPEN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeChatOpenForSession(open: boolean) {
  try {
    window.sessionStorage.setItem(CHAT_OPEN_SESSION_KEY, open ? "1" : "0");
  } catch {
    // Best-effort session continuity only.
  }
}
