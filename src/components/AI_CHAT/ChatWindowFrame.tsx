"use client";
import React, { useCallback, useEffect, useRef } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8055_FLOATING_ELEVATION_FLAG } from "@/lib/flags/definitions/htpr-8055-floating-elevation";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8988-chat-window-layout";
import { CHAT_WINDOW_MIN_HEIGHT, CHAT_WINDOW_MIN_WIDTH, clampChatWindowValue, type ChatWindowRect, type ChatWindowState, type ChatWindowViewport } from "@/lib/aiChat/chatWindows";

export function ChatWindowFrame({
  state,
  viewport,
  onFocus,
  onMove,
  onResize,
  inFront = false,
  children,
}: {
  state: ChatWindowState;
  viewport: ChatWindowViewport;
  onFocus: () => void;
  onMove: (rect: ChatWindowRect) => void;
  onResize: (rect: ChatWindowRect) => void;
  inFront?: boolean;
  children: React.ReactNode;
}) {
  const sideBySide = useFlag(HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG);
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const floatingElevation = useFlag(HTPR_8055_FLOATING_ELEVATION_FLAG);
  const dragStart = useRef<{ pointerX: number; pointerY: number; rect: ChatWindowRect } | null>(null);
  const resizeStart = useRef<{ pointerX: number; pointerY: number; rect: ChatWindowRect } | null>(null);
  const latestRect = useRef<ChatWindowRect>({ x: state.x, y: state.y, width: state.width, height: state.height });
  latestRect.current = { x: state.x, y: state.y, width: state.width, height: state.height };
  const move = useRef(onMove);
  move.current = onMove;
  const resize = useRef(onResize);
  resize.current = onResize;

  const stop = useCallback(() => {
    dragStart.current = null;
    resizeStart.current = null;
  }, []);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragStart.current;
      if (drag) {
        const rect = latestRect.current;
        move.current({
          ...rect,
          x: clampChatWindowValue(drag.rect.x + event.clientX - drag.pointerX, 0, viewport.width - rect.width),
          y: clampChatWindowValue(drag.rect.y + event.clientY - drag.pointerY, 0, viewport.height - rect.height),
        });
        return;
      }
      const sizing = resizeStart.current;
      if (sizing) {
        const width = clampChatWindowValue(sizing.rect.width - (event.clientX - sizing.pointerX), (sideBySide ? Math.min(CHAT_WINDOW_MIN_WIDTH, sizing.rect.width) : CHAT_WINDOW_MIN_WIDTH), sizing.rect.x + sizing.rect.width);
        const height = clampChatWindowValue(sizing.rect.height - (event.clientY - sizing.pointerY), (sideBySide ? Math.min(CHAT_WINDOW_MIN_HEIGHT, sizing.rect.height) : CHAT_WINDOW_MIN_HEIGHT), sizing.rect.y + sizing.rect.height);
        resize.current({
          x: sizing.rect.x + (sizing.rect.width - width),
          y: sizing.rect.y + (sizing.rect.height - height),
          width,
          height,
        });
      }
    };
    const handleUp = () => stop();
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [sideBySide, stop, viewport.height, viewport.width]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-chat-window-drag]")) return;
    if (target.closest("button, a, input, textarea, [contenteditable='true']")) return;
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, rect: latestRect.current };
    onFocus();
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStart.current = { pointerX: event.clientX, pointerY: event.clientY, rect: latestRect.current };
    onFocus();
  };

  return multiChatWindowsEnabled ? (
    <div
      role="dialog"
      aria-label="AI chat window"
      onPointerDownCapture={onFocus}
      className={`fixed ${sideBySide && !inFront ? "z-floating" : "z-popup"} flex flex-col overflow-hidden rounded-[4px] border border-border-light-gray-thin bg-ai-chat text-meta ${floatingElevation ? "shadow-floating" : "shadow-customshadow-4"}`}
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
        display: state.minimized ? "none" : undefined,
      }}
      onPointerDown={startDrag}
    >
      <div
        role="button"
        tabIndex={-1}
        aria-label="Resize AI chat window"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-3 w-3 cursor-nwse-resize"
      />
      {children}
    </div>
  ) : null;
}
