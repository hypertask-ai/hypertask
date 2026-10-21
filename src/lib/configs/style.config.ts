export const AI_CHAT_SIDEBAR_MIN_PX = 340;
export const AI_CHAT_SIDEBAR_DEFAULT_PX = 420;

export function getAiChatSidebarMaxPx(viewportWidth: number): number {
  return Math.min(900, Math.floor(viewportWidth * 0.85));
}

export function clampAiChatSidebarWidthPx(
  w: number,
  viewportWidth: number
): number {
  return Math.max(
    AI_CHAT_SIDEBAR_MIN_PX,
    Math.min(getAiChatSidebarMaxPx(viewportWidth), w)
  );
}

export function aiChatMainContentWidthCalc(sidebarWidthPx: number): string {
  return `calc(100% - ${sidebarWidthPx}px)`;
}
