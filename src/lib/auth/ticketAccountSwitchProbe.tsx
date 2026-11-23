"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSetRecoilState } from "@/lib/state";
import { showAccountSwitcherAtom } from "@/store";
import { submitTicketAccountSwitch } from "@/lib/auth/ticketDetailLocator";

export function TicketAccountSwitchProbe() {
  const pathname = usePathname() ?? "";
  const setShowAccountSwitcher = useSetRecoilState(showAccountSwitcherAtom);
  useEffect(() => {
    submitTicketAccountSwitch(pathname, () => setShowAccountSwitcher(true));
  }, [pathname, setShowAccountSwitcher]);
  return null;
}
