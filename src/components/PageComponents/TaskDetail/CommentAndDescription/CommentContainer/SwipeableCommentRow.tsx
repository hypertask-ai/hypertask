"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

const ENGAGE_PX = 10;
const COMMIT_PX = 72;
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

/**
 * Mobile comment gesture wrapper.
 *
 * Default: swipe left to reveal "More" and open the comment's Command Center
 * menu (same as the desktop hover ⋯).
 *
 * HTPR-6514 (`useLongPress`): press and hold instead. Swipe already moves the
 * whole task, so a comment swipe fights that gesture.
 */
const SwipeableCommentRow = ({
  children,
  onMore,
  useLongPress = false,
}: {
  children: ReactNode;
  onMore: () => void;
  useLongPress?: boolean;
}) => {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  const blockClick = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number; id: number } | null>(
    null,
  );

  const setOffsetSynced = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const reset = () => {
    start.current = null;
    engaged.current = false;
    setOffsetSynced(0);
  };

  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  };

  useEffect(() => () => clearLongPress(), []);

  if (useLongPress) {
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
  }

  return (
    <div className="relative overflow-hidden" style={{ touchAction: "pan-y" }}>
      {/* "More" panel revealed on the right as the bubble is dragged left. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-[3px] bg-[#3b3d42] text-[10px] font-bold text-white"
        style={{ width: Math.max(-offset, 0) }}
      >
        {offset < -24 && (
          <>
            <MoreHorizontal size={16} strokeWidth={2} className="keep-stroke" />
            <span>More</span>
          </>
        )}
      </div>

      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: start.current ? undefined : "transform 150ms ease-out",
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          start.current = { x: touch.clientX, y: touch.clientY };
          engaged.current = false;
          blockClick.current = false;
        }}
        onTouchMove={(event) => {
          if (!start.current) return;
          const touch = event.touches[0];
          const dx = touch.clientX - start.current.x;
          const dy = touch.clientY - start.current.y;

          if (!engaged.current) {
            // Let a vertical scroll claim the gesture and stay out of its way.
            if (Math.abs(dy) > Math.abs(dx)) {
              start.current = null;
              return;
            }
            if (Math.abs(dx) < ENGAGE_PX) return;
            engaged.current = true;
          }
          // Left swipe only; never drag the bubble to the right of its resting
          // spot (no action lives on that side).
          setOffsetSynced(Math.min(dx, 0));
        }}
        onTouchEnd={() => {
          if (engaged.current) {
            // Any real drag suppresses the click it would otherwise synthesise,
            // so a committed swipe never falls through to the tap handlers.
            blockClick.current = true;
            if (offsetRef.current <= -COMMIT_PX) onMore();
          }
          reset();
        }}
        onTouchCancel={reset}
        // A committed swipe must not also fire the tap handlers behind it
        // (single-tap select / double-tap edit).
        onClickCapture={(event) => {
          if (!blockClick.current) return;
          blockClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableCommentRow;
