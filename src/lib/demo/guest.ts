export const GUEST_UID_PREFIX = "guest_";
export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24;

export function isGuestUser(user: { uid?: string | null } | null | undefined): boolean {
  return user?.uid?.startsWith(GUEST_UID_PREFIX) ?? false;
}
