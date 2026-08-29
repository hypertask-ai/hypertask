import prisma from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

import { isGuestUser } from "./guest";

// HTPR-4303: funnel-only guest restrictions. Guests keep use of their own
// throwaway board; inviting/joining, billing, and paid dictation are blocked.
// Identity comes from the signed ht_session cookie — never from nookies_user,
// which is client-editable.
export async function isGuestRequest(req: {
  cookies: Partial<Record<string, string>>;
}): Promise<boolean> {
  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) return false;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { uid: true },
  });
  return isGuestUser(user);
}

export const GUEST_FORBIDDEN_MESSAGE =
  "Not available on demo boards. Sign up to unlock this.";

/** Check a user id that was already resolved from a signed server session. */
export async function isGuestUserId(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { uid: true },
  });
  return isGuestUser(user);
}

// Resolve the guest's userId + teamId from the signed session cookie, or null if
// the request is not an authenticated guest. Used by the demo chat route and the
// demo usage endpoint to meter/cap a guest's free AI allowance against their own
// team. Identity is the signed ht_session — never nookies_user.
export async function resolveGuestSession(
  sessionToken: string | undefined | null,
): Promise<{ userId: number; teamId: string | null } | null> {
  const session = verifySession(sessionToken ?? undefined);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { uid: true, accountId: true },
  });
  if (!isGuestUser(user)) return null;

  let teamId: string | null = null;
  if (user?.accountId) {
    const team = await prisma.team.findFirst({
      where: { googleAccountId: user.accountId },
      select: { id: true },
    });
    teamId = team?.id ?? null;
  }
  return { userId: session.id, teamId };
}
