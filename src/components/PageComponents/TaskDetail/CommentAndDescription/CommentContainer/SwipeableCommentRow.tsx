"use client";

import { ReactNode, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

const ENGAGE_PX = 10;
const COMMIT_PX = 72;

/**
 * Swipe a comment left to reveal a "More" panel; releasing past the commit
 * threshold opens the comment's Ctrl+K action menu (the same one the desktop
 * hover ⋯ opens). Touch-only: the desktop comment renders without this wrapper.
 *
 * Mirrors the inbox SwipeableNotificationRow gesture model. The swipe engages
 * only once horizontal travel beats vertical, so vertical list scrolling always
 * wins the ambiguous case; `touch-action: pan-y` tells the browser the same.
 */
const SwipeableCommentRow = ({
  children,
  onMore,
}: {
  children: ReactNode;
  onMore: () => void;
}) => {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0); // synchronous mirror of offset for the release decision
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);
  const blockClick = useRef(false); // suppress the click a committed drag would synthesise

  const setOffsetSynced = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  const reset = () => {
    start.current = null;
    engaged.current = false;
    setOffsetSynced(0);
  };

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
