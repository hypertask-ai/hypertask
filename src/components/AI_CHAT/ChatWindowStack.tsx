"use client";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ChatRuntime } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { clampChatWindowRect, tileChatWindowRect, type ChatWindowRect, type ChatWindowState } from "@/lib/aiChat/chatWindows";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8988-chat-window-layout";
import { useChatWindows, type ChatWindowsController } from "@/hooks/MultiPages/AIChat/useChatWindows";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { ChatWindow } from "./ChatWindow";
import { ChatWindowFrame } from "./ChatWindowFrame";

const COLLAPSED_ROW_BOTTOM_PX = 68;

const SecondaryChatWindow = memo(function SecondaryChatWindow({
  state,
  controller,
  onFocus,
}: {
  state: ChatWindowState;
  controller: ChatWindowsController;
  onFocus: () => void;
}) {
  const { id, sessionId } = state;
  const focus = useCallback(() => { onFocus(); controller.focus(id); }, [controller, id, onFocus]);
  const move = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => controller.resize(id, rect),
    [controller, id],
  );
  const windowScope = useMemo(() => ({ windowId: id, sessionId }), [id, sessionId]);
  const overrides = useMemo<Partial<ChatContextType>>(
    () => ({
      minimized: false,
      isSidebarMode: false,
      setIsSidebarMode: () => {},
      minimizeChat: () => controller.minimize(id),
      restoreChat: () => controller.restore(id),
      togglePopover: () => controller.close(id),
    }),
    [controller, id],
  );
  const attach = useCallback(
    (value: ChatContextType | undefined) => {
      const activeId = value?.currentSession?.id;
      if (activeId) controller.attachSession(id, activeId, value?.currentSession?.title ?? null);
    },
    [controller, id],
  );
  const body = useMemo(() => <ChatWindow framed />, []);

  return (
    <ChatWindowFrame
      state={state}
      viewport={controller.viewport}
      onFocus={focus}
      onMove={move}
      onResize={move}
    >
      <ChatRuntime windowScope={windowScope} overrides={overrides} onValue={attach}>
        {body}
      </ChatRuntime>
    </ChatWindowFrame>
  );
});

export default function ChatWindowStack({ userId }: { userId: number | null }) {
  const sideBySide = useFlag(HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG);
  const chat = useOptionalAiChatContext();
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const controller = useChatWindows(userId);
  const { windows } = controller;
  const collapsed = useMemo(() => windows.filter((window) => window.minimized), [windows]);

  const { viewport } = controller;
  const [primaryRect, setPrimaryRect] = useState<ChatWindowRect | null>(null);
  const [primaryInFront, setPrimaryInFront] = useState(false);
  const focusPrimary = useCallback(() => setPrimaryInFront(true), []);
  const focusSecondary = useCallback(() => setPrimaryInFront(false), []);
  const count = windows.length + 1;
  useEffect(() => {
    if (sideBySide && viewport.width > 0) setPrimaryRect(tileChatWindowRect(0, count, viewport));
  }, [sideBySide, count, viewport]);
  const movePrimary = useCallback((rect: ChatWindowRect) => {
    setPrimaryRect(clampChatWindowRect(rect, viewport, tileChatWindowRect(0, count, viewport)));
  }, [count, viewport]);
  const primaryVisible = sideBySide && chat?.showAiChatInterface && userId !== null;
  const windowStackReady = controller.enabled && viewport.width > 0 && (windows.length > 0 || primaryVisible);
  if (!windowStackReady) return null;

  return multiChatWindowsEnabled ? (
    <>
      {primaryVisible && !chat.minimized && (
        <ChatWindowFrame
          state={{
            ...(primaryRect ?? tileChatWindowRect(0, count, viewport)),
            id: "primary-chat",
            sessionId: chat.currentSession?.id ?? null,
            title: chat.currentSession?.title ?? null,
            userId,
            minimized: false,
          }}
          viewport={viewport}
          onFocus={focusPrimary}
          inFront={primaryInFront}
          onMove={movePrimary}
          onResize={movePrimary}
        >
          <ChatWindow framed primary />
        </ChatWindowFrame>
      )}
      {windows.map((state) => (
        <SecondaryChatWindow key={state.id} state={state} controller={controller} onFocus={focusSecondary} />
      ))}
      {(collapsed.length > 0 || (primaryVisible && chat.minimized)) && (
        <div
          data-chat-window-dock
          className={`fixed right-2 z-popup flex max-w-[calc(100vw-1rem)] items-center gap-1 ${sideBySide ? "flex-nowrap overflow-x-auto" : "flex-wrap justify-end"}`}
          style={{ bottom: sideBySide ? 0 : COLLAPSED_ROW_BOTTOM_PX }}
        >
          {primaryVisible && chat.minimized && <ChatWindow />}
          {collapsed.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => controller.restore(state.id)}
              className="group flex shrink-0 items-center gap-2 rounded-t-[4px] border-x border-t border-border-light-gray-thin bg-ai-chat px-3 py-2 text-white-black shadow-customshadow-4"
            >
              <span className="max-w-[160px] truncate text-meta font-medium">
                {state.title ?? "AI chat"}
              </span>
              <span
                role="button"
                aria-label="Close AI chat window"
                onClick={(event) => {
                  event.stopPropagation();
                  controller.close(state.id);
                }}
                className="text-icon-dark-gray hover:text-white-black"
              >
                <X size={14} strokeWidth={1.75} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  ) : null;
}
