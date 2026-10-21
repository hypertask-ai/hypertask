"use client";

import { useEffect, useRef } from "react";
import { captureBrowserEvent } from "@/lib/analytics/browserCapture";

export default function SignupPageViewed({ enabled, userId }: { enabled: boolean; userId: number | null }) {
  const capturedRef = useRef(false);

  useEffect(() => {
    if (!enabled || capturedRef.current) return;
    capturedRef.current = true;
    captureBrowserEvent({
      event: "signup_page_viewed",
      properties: {
        page_path: "/login",
        auth_state: userId === null ? "anonymous" : "authenticated",
        screen_mode: "unknown",
        source: "web",
        event_id: crypto.randomUUID(),
        user_id: userId === null ? null : String(userId),
        workspace_id: null,
        board_id: null,
        is_seeded: null,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        initial_referrer: null,
        attribution_status: "unknown",
        occurred_at: new Date().toISOString(),
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "unknown",
        account_category: null,
      },
    });
  }, [enabled, userId]);

  return null;
}
