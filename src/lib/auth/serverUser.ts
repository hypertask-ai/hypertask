import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import authConfig from "@/lib/configs/auth.config";
import prisma from "@/lib/prisma";
import type { IUser } from "@/models/model";

function parseUserCookieId(value: string): number | null {
  try {
    const parsed = JSON.parse(value) as { id?: unknown } | null;
    const id = Number(parsed?.id);

    if (!parsed || !Number.isFinite(id)) {
      return null;
    }

    return id;
  } catch (error) {
    console.log("Failed to parse server user cookie:", error);
    return null;
  }
}

export async function getServerCookieUser(): Promise<IUser | null> {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get(authConfig.cookies.user);

  if (!userCookie?.value) {
    return null;
  }

  const claimedId = parseUserCookieId(userCookie.value);
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (claimedId === null || !session || session.id !== claimedId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      uid: true,
      displayName: true,
      photoURL: true,
      email: true,
      joinedAt: true,
      UserSettingId: true,
      accountId: true,
      stripe_customer_id: true,
      UserSetting: true,
    },
  });

  return user as IUser | null;
}

// Transitional guard for pages that still depend on nookies_user before HTPR-3979 moves them to signed session auth.
export async function requireServerCookieUser(redirectTo = "/login"): Promise<IUser> {
  const user = await getServerCookieUser();

  if (!user) {
    redirect(redirectTo);
  }

  return user;
}
