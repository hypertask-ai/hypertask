"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { aiChatWindowsAtom, currentUserAtom, isAiChatSidebarModeAtom } from "@/store";
import { MOBILE_VIEWPORT_MAX_PX } from "./aiChatShared";
import {
  CHAT_WINDOW_MAX,
  CHAT_WINDOW_MIN_WIDTH,
  chatWindowForSession,
  closeChatWindow,
  moveChatWindowToFront,
  multiChatWindowsAvailable,
  openChatWindowForUser,
  readChatWindows,
  setChatWindowMinimized,
  updateChatWindow,
  type ChatWindowRect,
  type ChatWindowViewport,
} from "@/lib/aiChat/chatWindows";

const readViewport = (): ChatWindowViewport => ({
  width: typeof window === "undefined" ? 0 : window.innerWidth,
  height: typeof window === "undefined" ? 0 : window.innerHeight,
});

const newWindowId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `chat-window-${crypto.randomUUID()}`
    : `chat-window-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export function useChatWindows(verifiedUserId?: number | null) {
  const enabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const [currentUser] = useRecoilState(currentUserAtom);
  const [stored, setStored] = useRecoilState(aiChatWindowsAtom);
  const sidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const [viewport, setViewport] = useState<ChatWindowViewport>({ width: 0, height: 0 });
  const storedUserId = currentUser?.id ?? 0;
  let userId = storedUserId;
  if (verifiedUserId !== undefined) userId = verifiedUserId === storedUserId ? storedUserId : 0;

  useEffect(() => {
    if (!enabled) return;
    const resize = () => setViewport(readViewport());
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [enabled]);

  const desktop = viewport.width >= MOBILE_VIEWPORT_MAX_PX;
  const floating = multiChatWindowsAvailable({ enabled, desktop, sidebarMode });
  const windows = useMemo(() => {
    if (!floating || viewport.width < CHAT_WINDOW_MIN_WIDTH || userId <= 0) return [];
    return readChatWindows(stored, viewport, userId);
  }, [floating, stored, userId, viewport]);

  const focus = useCallback(
    (id: string) => setStored((previous) => moveChatWindowToFront(previous, id)),
    [setStored],
  );

  const restore = useCallback(
    (id: string) =>
      setStored((previous) => moveChatWindowToFront(setChatWindowMinimized(previous, id, false), id)),
    [setStored],
  );

  const focusOpenSession = useCallback(
    (sessionId: string) => {
      const existing = chatWindowForSession(windows, sessionId);
      if (!existing) return false;
      restore(existing.id);
      focus(existing.id);
      return true;
    },
    [focus, restore, windows],
  );

  const open = useCallback(
    (sessionId: string | null) => {
      if (!floating || userId <= 0) return false;
      if (sessionId && focusOpenSession(sessionId)) return true;
      if (windows.length >= CHAT_WINDOW_MAX) return false;
      setStored((previous) =>
        openChatWindowForUser(previous, { id: newWindowId(), sessionId, title: null, userId }, readViewport()),
      );
      return true;
    },
    [floating, focusOpenSession, setStored, userId, windows],
  );

  const close = useCallback(
    (id: string) => setStored((previous) => closeChatWindow(previous, id)),
    [setStored],
  );

  const minimize = useCallback(
    (id: string) => setStored((previous) => setChatWindowMinimized(previous, id, true)),
    [setStored],
  );

  const resize = useCallback(
    (id: string, rect: Partial<ChatWindowRect>) =>
      setStored((previous) => updateChatWindow(previous, id, rect, readViewport())),
    [setStored],
  );

  const attachSession = useCallback(
    (id: string, sessionId: string, title: string | null) =>
      setStored((previous) => {
        let changed = false;
        const next = previous.map((window) => {
          if (window.id !== id) return window;
          if (window.sessionId === sessionId && window.title === title) return window;
          changed = true;
          return { ...window, sessionId, title };
        });
        return changed ? next : previous;
      }),
    [setStored],
  );

  return {
    enabled: floating,
    windows,
    atCapacity: windows.length >= CHAT_WINDOW_MAX,
    viewport,
    open,
    focusOpenSession,
    focus,
    close,
    minimize,
    restore,
    resize,
    attachSession,
  };
}

export type ChatWindowsController = ReturnType<typeof useChatWindows>;
