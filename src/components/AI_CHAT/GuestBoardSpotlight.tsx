"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GUEST_SPOTLIGHT_SEEN_KEY } from "@/lib/demo/guestBoardBuild";

const REVEAL_DELAY_MS = 4000;

export const GuestBoardSpotlight = ({ onReveal }: { onReveal: () => void }) => {
  const [visible, setVisible] = useState(false);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(GUEST_SPOTLIGHT_SEEN_KEY) === "true")
        return;
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(GUEST_SPOTLIGHT_SEEN_KEY, "true");
      } catch {
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
