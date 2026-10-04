"use client";

import { ReactNode, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

/**
 * Mobile comment gesture wrapper.
 *
 * Press and hold to open the comment's Command Center menu. Swipe already
 * moves the whole task, so a comment swipe fights that gesture.
 */
const SwipeableCommentRow = ({
  children,
  onMore,
}: {
  children: ReactNode;
  onMore: () => void;
}) => {
  const blockClick = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number; id: number } | null>(
    null,
  );

  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  };

  useEffect(() => () => clearLongPress(), []);

  return (
    <div
      className="relative"
      style={{
        touchAction: "pan-y",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        longPressStart.current = {
          x: event.clientX,
          y: event.clientY,
          id: event.pointerId,
        };
        blockClick.current = false;
        if (longPressTimer.current != null) {
          window.clearTimeout(longPressTimer.current);
        }
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null;
          longPressStart.current = null;
          blockClick.current = true;
          onMore();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        const origin = longPressStart.current;
        if (!origin || event.pointerId !== origin.id) return;
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
          clearLongPress();
        }
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onClickCapture={(event) => {
        if (!blockClick.current) return;
        blockClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
};

export default SwipeableCommentRow;
