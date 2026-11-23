"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signedInUserId, ticketAccountSwitchFlagOn } from "@/lib/auth/ticketDetailLocator";

export function TicketAccountSwitchSlot() {
  const queryClient = useQueryClient();
  const userId = signedInUserId();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient]
  );
  const readFlags = useCallback(
    () => ticketAccountSwitchFlagOn(queryClient.getQueryData<Record<string, boolean>>(["feature-flags", userId])),
    [queryClient, userId]
  );
  const enabled = useSyncExternalStore(subscribe, readFlags, () => false);
  const [Probe, setProbe] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import("@/lib/auth/ticketAccountSwitchProbe")
      .then((mod) => {
        if (!cancelled) setProbe(() => mod.TicketAccountSwitchProbe);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled && Probe ? <Probe /> : null;
}
