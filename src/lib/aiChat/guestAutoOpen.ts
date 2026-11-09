import { isGuestUser } from "@/lib/demo/guest";
import type { AiChatAutoOpenKey } from "./autoOpenPreferences";

export function guestAutoOpenAllowed({
  user,
  page,
  mobile,
}: {
  user: { uid?: string | null } | null | undefined;
  page: AiChatAutoOpenKey | null;
  mobile: boolean;
}): boolean {
  if (mobile || page !== "aiChatOpenBoards") return false;
  return isGuestUser(user);
}

export function signedInBoardAutoOpenAllowed({
  manualChat,
  page,
  mobile,
  savedPreference,
  pinned,
}: {
  manualChat: boolean;
  page: AiChatAutoOpenKey | null;
  mobile: boolean;
  savedPreference: boolean;
  pinned: boolean;
}): boolean {
  if (manualChat || page === null) return false;
  return savedPreference || (pinned && !mobile);
}
