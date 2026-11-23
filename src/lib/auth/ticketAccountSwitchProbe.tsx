"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { parseCookies } from "nookies";
import authConfig from "@/lib/configs/auth.config";
import { HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG } from "@/lib/flags/definitions/htpr-9621-auto-switch-account";
import { submitTicketAccountSwitch } from "@/lib/auth/ticketDetailLocator";

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
  const client = useQueryClient();
  const store = useStore();
  useEffect(() => {
    const ask = () => {
      const userId = signedInUserId();
      if (!userId) return;
      const flags = client.getQueryData<Record<string, boolean>>(["feature-flags", userId]);
      if (flags?.[HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG] !== true) return;
      void import("@/store").then((mod) => {
        submitTicketAccountSwitch(pathname, () => {
          store.set(mod.showAccountSwitcherAtom, true);
        });
      });
    };
    ask();
    return client.getQueryCache().subscribe(ask);
  }, [pathname, client, store]);
  return null;
}
