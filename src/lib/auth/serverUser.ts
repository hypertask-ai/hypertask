import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import authConfig from "@/lib/configs/auth.config";
import type { IUser } from "@/models/model";

function parseUserCookie(value: string): IUser | null {
  try {
    const parsed = JSON.parse(value) as Partial<IUser> | null;
    const id = Number(parsed?.id);

    if (!parsed || !Number.isFinite(id)) {
      return null;
    }

    return { ...parsed, id } as IUser;
  } catch (error) {
    console.log("Failed to parse server user cookie:", error);
    return null;
  }
}

export async function getServerCookieUser(): Promise<IUser | null> {
  const userCookie = (await cookies()).get(authConfig.cookies.user);

  if (!userCookie?.value) {
    return null;
  }

  return parseUserCookie(userCookie.value);
}

// Transitional guard for pages that still depend on nookies_user before HTPR-3979 moves them to signed session auth.
export async function requireServerCookieUser(redirectTo = "/login"): Promise<IUser> {
  const user = await getServerCookieUser();

  if (!user) {
    redirect(redirectTo);
  }

  return user;
}
