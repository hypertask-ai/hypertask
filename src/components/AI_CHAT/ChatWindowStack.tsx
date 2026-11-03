"use client";
import React, { memo, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { ChatRuntime } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import type { ChatWindowState } from "@/lib/aiChat/chatWindows";
import { useChatWindows, type ChatWindowsController } from "@/hooks/MultiPages/AIChat/useChatWindows";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { ChatWindow } from "./ChatWindow";
import { ChatWindowFrame } from "./ChatWindowFrame";

const COLLAPSED_ROW_BOTTOM_PX = 68;

const SecondaryChatWindow = memo(function SecondaryChatWindow({
  state,
  controller,
}: {
  state: ChatWindowState;
  controller: ChatWindowsController;
}) {
  const { id, sessionId } = state;
  const focus = useCallback(() => controller.focus(id), [controller, id]);
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
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const controller = useChatWindows(userId);
  const { windows } = controller;
  const collapsed = useMemo(() => windows.filter((window) => window.minimized), [windows]);

  const windowStackReady = controller.enabled && controller.viewport.width > 0 && windows.length > 0;
  if (!windowStackReady) return null;

  return multiChatWindowsEnabled ? (
    <>
      {windows.map((state) => (
        <SecondaryChatWindow key={state.id} state={state} controller={controller} />
      ))}
      {collapsed.length > 0 && (
        <div
          className="fixed right-2 z-popup flex flex-wrap items-center justify-end gap-1"
          style={{ bottom: COLLAPSED_ROW_BOTTOM_PX }}
        >
          {collapsed.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => controller.restore(state.id)}
              className="group flex items-center gap-2 rounded-t-sm border-x border-t border-border-light-gray-thin bg-ai-chat px-3 py-2 text-white-black shadow-customshadow-4"
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
