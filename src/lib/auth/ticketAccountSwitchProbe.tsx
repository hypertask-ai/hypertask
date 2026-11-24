"use client";

import { useContext, useEffect } from "react";
import { usePathname } from "next/navigation";
import { QueryClientContext } from "@tanstack/react-query";
import { useStore } from "jotai";
import {
  signedInUserId,
  submitTicketAccountSwitch,
  ticketAccountSwitchFlagOn,
} from "@/lib/auth/ticketDetailLocator";

export function TicketAccountSwitchProbe() {
  const pathname = usePathname() ?? "";
  const client = useContext(QueryClientContext);
  const store = useStore();
  useEffect(() => {
    if (!client) return;
    const flagsClient = client;
    const ask = () => {
      const userId = signedInUserId();
      if (!userId) return;
      const flags = flagsClient.getQueryData<Record<string, boolean>>(["feature-flags", userId]);
      if (!ticketAccountSwitchFlagOn(flags)) return;
      void import("@/store").then((mod) => {
        submitTicketAccountSwitch(pathname, () => {
          store.set(mod.showAccountSwitcherAtom, true);
        });
      });
    };
    ask();
    return flagsClient.getQueryCache().subscribe(ask);
  }, [pathname, client, store]);
  return null;
}
