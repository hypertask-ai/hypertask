import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isSessionTokenRevoked } from "@/lib/auth/sessionRevocation";
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

  let userId: number;
  if (!userCookie?.value) {
    const { getSessionUser } = await import("@/lib/auth/getSessionUser");
    const session = await getSessionUser(await headers());
    if (session?.source !== "cli-bearer") return null;
    userId = session.userId;
  } else {
    const claimedId = parseUserCookieId(userCookie.value);
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    const session = verifySession(token);
    if (claimedId === null || !session || session.id !== claimedId) {
      return null;
    }

    if (await isSessionTokenRevoked(token, { failClosed: false })) return null;
    userId = session.id;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
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

export async function requireServerCookieUser(redirectTo = "/login"): Promise<IUser> {
  const user = await getServerCookieUser();

  if (!user) {
    redirect(redirectTo);
  }

  return user;
}
