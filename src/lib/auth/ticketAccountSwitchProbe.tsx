"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSetRecoilState } from "@/lib/state";
import { showAccountSwitcherAtom } from "@/store";
import { submitTicketAccountSwitch } from "@/lib/auth/ticketDetailLocator";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG } from "@/lib/flags/definitions/htpr-9621-auto-switch-account";

export function TicketAccountSwitchProbe() {
  const enabled = useFlag(HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG);
  const pathname = usePathname() ?? "";
  const setShowAccountSwitcher = useSetRecoilState(showAccountSwitcherAtom);
  useEffect(() => {
    if (!enabled) return;
    submitTicketAccountSwitch(pathname, () => setShowAccountSwitcher(true));
  }, [enabled, pathname, setShowAccountSwitcher]);
  return null;
}
