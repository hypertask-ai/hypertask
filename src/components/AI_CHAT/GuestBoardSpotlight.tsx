"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GUEST_SPOTLIGHT_SEEN_KEY } from "@/lib/demo/guestBoardBuild";

const REVEAL_DELAY_MS = 4000;

/**
 * One-shot pointer at the chat for a guest landing on an empty board: an accent
 * bubble parks against the chat panel's left edge and points at it (HTPR-4882;
 * the board no longer dims, Valentin cut that 2026-08-02). The sidebar
 * publishes its width, so the bubble finds the edge without a z-index fight,
 * and it takes no pointer events, so the board stays fully interactive. Any key
 * or any click clears it, and it fires once per browser.
 */
export const GuestBoardSpotlight = ({ onReveal }: { onReveal: () => void }) => {
  const [visible, setVisible] = useState(false);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(GUEST_SPOTLIGHT_SEEN_KEY) === "true")
        return;
    } catch {
      // Storage blocked: skip rather than risk showing this on every load.
      return;
    }
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(GUEST_SPOTLIGHT_SEEN_KEY, "true");
      } catch {
        // Already showing it; nothing left to do if the write fails.
      }
      setVisible(true);
      onRevealRef.current();
    }, REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setVisible(false);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("click", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("click", dismiss);
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      role="presentation"
      style={{
        right: "calc(var(--ht-ai-sidebar-width, 0px) + 12px)",
        background: "hsl(var(--primary))",
      }}
      // ponytail: animate-pulse is Tailwind's built-in opacity breathe, so no
      // custom keyframe. It also leaves the -translate-y-1/2 alone, which a
      // scale animation would clobber.
      className="pointer-events-none fixed top-1/2 z-[300] -translate-y-1/2 animate-pulse whitespace-nowrap rounded-[5px] px-3 py-2 text-meta text-white shadow-customshadow-2"
    >
      Tell the AI what this board is for
      <span
        aria-hidden
        style={{ background: "hsl(var(--primary))" }}
        className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45"
      />
    </div>,
    document.body
  );
};
