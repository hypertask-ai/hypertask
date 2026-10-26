"use client";

import { useEffect } from "react";

import { AI_CHIP_SIGNAL, createAiChipRecorder, isAiChipSignal, type AiChipEventPayload } from "@/lib/ai/chipEvents";
import { getCookieConsent } from "@/lib/cookieConsent";

function postChipEvent(payload: AiChipEventPayload) {
  if (getCookieConsent() === "essential") return;
  void fetch("/api/ai/chip-events", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function AiChipEventRecorder({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated) return;
    const recorder = createAiChipRecorder(postChipEvent);
    const onSignal = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (isAiChipSignal(detail)) recorder.handle(detail);
    };
    const onLeave = () => recorder.leave();
    window.addEventListener(AI_CHIP_SIGNAL, onSignal);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener(AI_CHIP_SIGNAL, onSignal);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [authenticated]);

  return null;
}
