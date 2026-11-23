"use client";

import { useContext, useEffect } from "react";
import { usePathname } from "next/navigation";
import { QueryClientContext } from "@tanstack/react-query";
import { useStore } from "jotai";
import { parseCookies } from "nookies";
import toast from "react-hot-toast";
import authConfig from "@/lib/configs/auth.config";
import { HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG } from "@/lib/flags/definitions/htpr-9621-auto-switch-account";
import { submitTicketAccountSwitch, syncSwitchedAccountTabs } from "@/lib/auth/ticketDetailLocator";

function signedInUserId(): number {
  try {
    const raw = parseCookies()?.[authConfig.cookies.user];
    if (!raw) return 0;
    const id = Number(JSON.parse(raw).id);
    return Number.isInteger(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

export function TicketAccountSwitchProbe() {
  const pathname = usePathname() ?? "";
  const client = useContext(QueryClientContext);
  const store = useStore();
  useEffect(() => {
    if (!client) return;
    return syncSwitchedAccountTabs(signedInUserId(), (message) => {
      toast(message);
    });
  }, [pathname, client]);
  useEffect(() => {
    if (!client) return;
    const flagsClient = client;
    const ask = () => {
      const userId = signedInUserId();
      if (!userId) return;
      const flags = flagsClient.getQueryData<Record<string, boolean>>(["feature-flags", userId]);
      if (flags?.[HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG] !== true) return;
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
