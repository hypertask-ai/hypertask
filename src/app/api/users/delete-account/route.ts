import { NextResponse } from "next/server";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import {
  SESSION_COOKIE,
  clearBetterAuthSessionCookies,
} from "@/lib/auth/session";
import { resetUserAccount } from "@/utils/controllers/users/resetUserAccount";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// HTPR-4854: self-serve account wipe. The user can only ever delete their own
// account, so the target id comes from the session cookie and never the body.
export async function POST() {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const result = await resetUserAccount(Number(user.id));
  if (result.status !== 200) {
    return NextResponse.json(result.json, { status: result.status });
  }

  const response = NextResponse.json({ success: true });
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("nookies_user", "", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  clearBetterAuthSessionCookies(response);

  return response;
}
