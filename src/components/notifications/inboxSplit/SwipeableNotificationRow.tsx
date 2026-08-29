"use client";

import { ReactNode, useRef, useState } from "react";
import { Archive, Clock } from "lucide-react";

const ENGAGE_PX = 10;
const COMMIT_PX = 88;

/**
 * Swipe left to archive, swipe right to snooze, on the existing inbox row.
 *
 * The gesture only engages once horizontal travel beats vertical travel, so
 * vertical list scrolling always wins the ambiguous case. touch-action pan-y
 * tells the browser the same thing, which keeps scrolling smooth while we are
 * still deciding.
 */
const SwipeableNotificationRow = ({
  children,
  onArchive,
  onSnooze,
}: {
  children: ReactNode;
  onArchive: () => void;
  onSnooze: () => void;
}) => {
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const engaged = useRef(false);

  const reset = () => {
    start.current = null;
    engaged.current = false;
    setOffset(0);
  };

  return (
    <div className="relative overflow-hidden" style={{ touchAction: "pan-y" }}>
      {/* Coloured panels revealed by the drag, on the side being swiped from. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 flex flex-col items-center justify-center gap-[3px] bg-[#e5a13a] text-[10px] font-bold text-white"
        style={{ width: Math.max(offset, 0) }}
      >
        {offset > 24 && (
          <>
            <Clock size={16} strokeWidth={2} className="keep-stroke" />
            <span>Snooze</span>
          </>
        )}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-[3px] bg-[#2fbf71] text-[10px] font-bold text-white"
        style={{ width: Math.max(-offset, 0) }}
      >
        {offset < -24 && (
          <>
            <Archive size={16} strokeWidth={2} className="keep-stroke" />
            <span>Done</span>
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
          setOffset(dx);
        }}
        onTouchEnd={() => {
          if (engaged.current) {
            if (offset >= COMMIT_PX) onSnooze();
            else if (offset <= -COMMIT_PX) onArchive();
          }
          reset();
        }}
        onTouchCancel={reset}
        // A committed swipe must not also open the task behind it.
        onClickCapture={(event) => {
          if (!engaged.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableNotificationRow;
