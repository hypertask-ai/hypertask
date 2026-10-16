"use client";

import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { setIdentifyEventIds } from "@/lib/analytics/browserCapture";
import { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG } from "@/lib/flags/keys";

export default function IdentifyEventIdFlag() {
  const enabled = useFlag(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG);

  useEffect(() => {
    setIdentifyEventIds(enabled);
    return () => setIdentifyEventIds(false);
  }, [enabled]);

  return null;
}
