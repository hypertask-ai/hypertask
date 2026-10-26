"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { aiChatSidebarPreferredWidthsAtom, aiChatSidebarWidthPxAtom, currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8013_SIDEBAR_WIDTH_FLAG } from "@/lib/flags/definitions/htpr-8013-sidebar-width";
import {
  AI_CHAT_SIDEBAR_DEFAULT_PX,
  AI_CHAT_SIDEBAR_MIN_PX,
  clampAiChatSidebarWidthPx,
  getAiChatSidebarMaxPx,
} from "@/lib/configs/style.config";
import { cn } from "@/utils/undoActions/helperFuncs";

export function AiChatSidebarResizeHandle() {
  const [widthPx, setWidthPx] = useRecoilState(aiChatSidebarWidthPxAtom);
  const rememberWidth = useFlag(HTPR_8013_SIDEBAR_WIDTH_FLAG);
  const userId = useRecoilValue(currentUserAtom)?.id;
  const [preferredWidths, setPreferredWidths] = useRecoilState(aiChatSidebarPreferredWidthsAtom);
  const savedWidth = userId === undefined ? undefined : preferredWidths?.[userId];
  const fallbackWidth = preferredWidths === null ? widthPx : AI_CHAT_SIDEBAR_DEFAULT_PX;
  const preferredWidth = typeof savedWidth === "number" && Number.isFinite(savedWidth)
    ? savedWidth : fallbackWidth;
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(widthPx);
  widthRef.current = widthPx;

  const needsMigration = rememberWidth && userId !== undefined && preferredWidths === null;
  useEffect(() => {
    if (needsMigration && userId !== undefined && widthPx !== AI_CHAT_SIDEBAR_DEFAULT_PX) {
      setPreferredWidths({ [userId]: widthRef.current });
    }
  }, [needsMigration, userId, widthPx, setPreferredWidths]);

  useEffect(() => {
    const onResize = () => {
      setWidthPx((w) => clampAiChatSidebarWidthPx(
        rememberWidth && userId !== undefined ? preferredWidth : w, window.innerWidth
      ));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setWidthPx, rememberWidth, userId, preferredWidth]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startW = widthRef.current;
    const startX = e.clientX;
    setIsDragging(true);
    document.body.style.userSelect = "none";

    let draggedWidth: number | undefined;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = startW - delta;
      draggedWidth = clampAiChatSidebarWidthPx(next, window.innerWidth);
      setWidthPx(draggedWidth);
    };
    const stopDragging = () => {
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    const onUp = rememberWidth ? () => {
      if (userId !== undefined && draggedWidth !== undefined) {
        const width = draggedWidth;
        setPreferredWidths((widths) => ({ ...widths, [userId]: width }));
      }
      stopDragging();
    } : stopDragging;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const accent = isDragging || isHovered;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={AI_CHAT_SIDEBAR_MIN_PX}
      aria-valuemax={getAiChatSidebarMaxPx(
        typeof window !== "undefined" ? window.innerWidth : 1920
      )}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        if (!isDragging) setIsHovered(false);
      }}
      className={cn(
        "relative z-[52] hidden w-1 shrink-0 cursor-col-resize md:block",
        isDragging && "select-none"
      )}
      data-dragging={isDragging || undefined}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          !isDragging && "transition-colors duration-150",
          accent ? "bg-hypertasks-header-blue" : "bg-white/15"
        )}
      />
      <span
        className={cn(
          "border pointer-events-none absolute left-1/2 top-1/2 h-6 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full",
          !isDragging && "transition-all duration-150",
          isDragging
            ? "scale-110 bg-hypertasks-header-blue"
            : isHovered
              ? "bg-[#666666]"
              : " border-white/20 bg-transparent"
        )}
      />
    </div>
  );
}
