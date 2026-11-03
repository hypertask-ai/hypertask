export type ChatWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ChatWindowState = ChatWindowRect & {
  id: string;
  sessionId: string | null;
  title: string | null;
  userId: number;
  minimized: boolean;
};

export type ChatWindowControls = {
  enabled: boolean;
  openSessionWindow: (sessionId: string) => boolean;
  focusOpenSessionWindow: (sessionId: string) => boolean;
  openNewChatWindow: () => Promise<boolean>;
};

export type AiChatWindowScope = {
  windowId: string;
  sessionId: string | null;
};

export type ChatWindowViewport = {
  width: number;
  height: number;
};

export const CHAT_WINDOW_MIN_WIDTH = 360;
export const CHAT_WINDOW_MIN_HEIGHT = 280;
export const CHAT_WINDOW_EDGE = 8;
export const CHAT_WINDOW_STAGGER = 32;
export const CHAT_WINDOW_MAX = 4;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function clampChatWindowRect(
  rect: ChatWindowRect,
  viewport: ChatWindowViewport,
): ChatWindowRect {
  const maxWidth = Math.max(CHAT_WINDOW_MIN_WIDTH, viewport.width - CHAT_WINDOW_EDGE * 2);
  const maxHeight = Math.max(CHAT_WINDOW_MIN_HEIGHT, viewport.height - CHAT_WINDOW_EDGE * 2);
  const width = clamp(rect.width, CHAT_WINDOW_MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, CHAT_WINDOW_MIN_HEIGHT, maxHeight);
  const x = clamp(rect.x, 0, viewport.width - width - CHAT_WINDOW_EDGE);
  const y = clamp(rect.y, 0, viewport.height - height - CHAT_WINDOW_EDGE);
  return { x, y, width, height };
}

export function cascadeChatWindowRect(
  index: number,
  viewport: ChatWindowViewport,
): ChatWindowRect {
  const width = clamp(Math.round(viewport.width * 0.3), CHAT_WINDOW_MIN_WIDTH, 560);
  const height = clamp(Math.round(viewport.height * 0.7), CHAT_WINDOW_MIN_HEIGHT, viewport.height - CHAT_WINDOW_EDGE * 2);
  const offset = Math.max(0, index) * CHAT_WINDOW_STAGGER;
  return clampChatWindowRect(
    {
      x: viewport.width - width - CHAT_WINDOW_EDGE - offset,
      y: viewport.height - height - CHAT_WINDOW_EDGE - offset,
      width,
      height,
    },
    viewport,
  );
}

export function createChatWindow(
  window: { id: string; sessionId: string | null; title: string | null; userId: number },
  index: number,
  viewport: ChatWindowViewport,
): ChatWindowState {
  return { ...window, minimized: false, ...cascadeChatWindowRect(index, viewport) };
}

export function openChatWindowForUser(
  windows: ChatWindowState[],
  window: { id: string; sessionId: string | null; title: string | null; userId: number },
  viewport: ChatWindowViewport,
): ChatWindowState[] {
  const mine = windows.filter((open) => open.userId === window.userId);
  if (mine.length >= CHAT_WINDOW_MAX) return windows;
  if (window.sessionId && mine.some((open) => open.sessionId === window.sessionId)) return windows;
  return [...windows, createChatWindow(window, mine.length, viewport)];
}

export function closeChatWindow(windows: ChatWindowState[], id: string): ChatWindowState[] {
  return windows.filter((window) => window.id !== id);
}

export function updateChatWindow(
  windows: ChatWindowState[],
  id: string,
  patch: Partial<Omit<ChatWindowState, "id" | "userId">>,
  viewport: ChatWindowViewport,
): ChatWindowState[] {
  return windows.map((window) => {
    if (window.id !== id) return window;
    const next = { ...window, ...patch };
    return { ...next, ...clampChatWindowRect(next, viewport) };
  });
}

export function setChatWindowMinimized(
  windows: ChatWindowState[],
  id: string,
  minimized: boolean,
): ChatWindowState[] {
  return windows.map((window) => (window.id === id ? { ...window, minimized } : window));
}

export function moveChatWindowToFront(
  windows: ChatWindowState[],
  id: string,
): ChatWindowState[] {
  if (windows.length < 2) return windows;
  const window = windows.find((open) => open.id === id);
  if (!window || windows[windows.length - 1]?.id === id) return windows;
  return [...windows.filter((open) => open.id !== id), window];
}

export function chatWindowForSession(
  windows: ChatWindowState[],
  sessionId: string,
): ChatWindowState | undefined {
  return windows.find((window) => window.sessionId === sessionId);
}

export function readChatWindows(
  raw: unknown,
  viewport: ChatWindowViewport,
  userId: number,
): ChatWindowState[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const windows: ChatWindowState[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<ChatWindowState>;
    if (typeof candidate.id !== "string" || seen.has(candidate.id)) continue;
    if (candidate.userId !== userId) continue;
    if (candidate.sessionId !== null && typeof candidate.sessionId !== "string") continue;
    if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) continue;
    if (!isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height)) continue;
    seen.add(candidate.id);
    const rect = clampChatWindowRect(
      { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height },
      viewport,
    );
    windows.push({
      id: candidate.id,
      sessionId: candidate.sessionId ?? null,
      title: typeof candidate.title === "string" ? candidate.title : null,
      userId,
      minimized: candidate.minimized === true,
      ...rect,
    });
    if (windows.length >= CHAT_WINDOW_MAX) break;
  }
  return windows;
}
