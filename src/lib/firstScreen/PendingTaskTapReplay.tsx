"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { consumePendingTaskTap, PENDING_TASK_TAP_EVENT } from "./pendingTaskTap";

/** Opens a card tapped before hydration (HTPR-7130) with a client navigation. */
export default function PendingTaskTapReplay() {
  const router = useRouter();
  useEffect(() => {
    const replay = () => {
      const href = consumePendingTaskTap(window);
      if (href) router.push(href);
    };
    replay();
    window.addEventListener(PENDING_TASK_TAP_EVENT, replay);
    return () => window.removeEventListener(PENDING_TASK_TAP_EVENT, replay);
  }, [router]);
  return null;
}
