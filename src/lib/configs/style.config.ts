/** AI chat sidebar width (desktop). Used with `aiChatSidebarWidthPxAtom` + resize handle. */
// 280 left roughly 220px for text once padding and list indent were taken out, so every
// bullet in an answer wrapped three or four times and the panel read as squashed
// (HTPR-4720). 340 is the narrowest that keeps a normal bullet on one or two lines.
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

/** CSS `width` for fixed chrome (header, tips bar) when AI sidebar is open. */
export function aiChatMainContentWidthCalc(sidebarWidthPx: number): string {
  return `calc(100% - ${sidebarWidthPx}px)`;
}
