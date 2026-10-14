import nookies from "nookies";

import { GUEST_UID_PREFIX } from "./guest";

export function isGuestCookieUser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = nookies.get(null)["nookies_user"];
    if (!raw) return false;
    const uid = (JSON.parse(raw) as { uid?: string | null })?.uid;
    return uid?.startsWith(GUEST_UID_PREFIX) ?? false;
  } catch {
    return false;
  }
}
