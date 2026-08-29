import nookies from "nookies";

import { GUEST_UID_PREFIX } from "./guest";

// HTPR-4303: guests live on the REAL board (/project?id=...), so demo behavior
// (cheap chat route, demo suggestions, auto-open chat) keys off the guest
// identity in the non-httpOnly nookies_user cookie, not the /demo pathname.
// Client-side only; server code must use the signed ht_session instead.
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
