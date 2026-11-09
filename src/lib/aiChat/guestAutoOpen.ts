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

export function boardChatAutoOpenAllowed({
  enabled,
  user,
  page,
  mobile,
  manualChat,
  savedPreference,
  pinned,
}: {
  enabled: boolean;
  user: { uid?: string | null } | null | undefined;
  page: AiChatAutoOpenKey | null;
  mobile: boolean;
  manualChat: boolean;
  savedPreference: boolean;
  pinned: boolean;
}): boolean {
  if (page === null) return false;
  if (guestAutoOpenAllowed({ enabled, user, page, mobile })) return true;
  if (manualChat) return false;
  return savedPreference || (pinned && !mobile);
}
