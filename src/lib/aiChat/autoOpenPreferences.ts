export const AI_CHAT_AUTO_OPEN_DEFAULTS = {
  aiChatOpenNewTickets: true,
  aiChatOpenTickets: false,
  aiChatOpenBoards: false,
};

export type AiChatAutoOpenPreferences = typeof AI_CHAT_AUTO_OPEN_DEFAULTS;
export type AiChatAutoOpenKey = keyof AiChatAutoOpenPreferences;
export const AI_CHAT_AUTO_OPEN_KEYS = Object.keys(AI_CHAT_AUTO_OPEN_DEFAULTS) as AiChatAutoOpenKey[];

export function migrateAiChatAutoOpenPreferences(saved: Record<string, unknown>): AiChatAutoOpenPreferences {
  if (Object.hasOwn(saved, "keepAiChatClosed") && saved.keepAiChatClosed === true) {
    return { aiChatOpenNewTickets: false, aiChatOpenTickets: false, aiChatOpenBoards: false };
  }
  const open = Object.hasOwn(saved, "openAiChatByDefault") && saved.openAiChatByDefault === true;
  return { ...AI_CHAT_AUTO_OPEN_DEFAULTS, aiChatOpenTickets: open, aiChatOpenBoards: open };
}

export function readLocalAiChatAutoOpenPreferences(): AiChatAutoOpenPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem("recoil-persist") ?? "{}");
    return migrateAiChatAutoOpenPreferences(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});
  } catch {
    return { ...AI_CHAT_AUTO_OPEN_DEFAULTS };
  }
}

export function aiChatAutoOpenPage(pathname: string, newTicketPath: string | null): AiChatAutoOpenKey | null {
  if (pathname.startsWith("/detail/")) {
    return pathname === newTicketPath ? "aiChatOpenNewTickets" : "aiChatOpenTickets";
  }
  if (/^\/(project|demo|my-tasks|inbox|calendar)(\/|$)/.test(pathname)) return "aiChatOpenBoards";
  return null;
}
