export const CHAT_OPEN_SESSION_KEY = "ht:aiChatOpen";

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
  }
}
