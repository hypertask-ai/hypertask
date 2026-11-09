import { isGuestUser } from "@/lib/demo/guest";
import type { AiChatAutoOpenKey } from "./autoOpenPreferences";

export function guestAutoOpenAllowed({
  enabled,
  user,
  page,
  mobile,
}: {
  enabled: boolean;
  user: { uid?: string | null } | null | undefined;
  page: AiChatAutoOpenKey | null;
  mobile: boolean;
}): boolean {
  if (!enabled || mobile || page !== "aiChatOpenBoards") return false;
  return isGuestUser(user);
}
