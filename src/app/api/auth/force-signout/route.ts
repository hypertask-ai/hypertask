import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/betterAuth";
import { parseCookies } from "better-auth/cookies";
import { revokeSessionToken } from "@/lib/auth/sessionRevocation";
import {
  SESSION_COOKIE,
  clearBetterAuthSessionCookies,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  await revokeSessionToken(parseCookies(cookieHeader).get(SESSION_COOKIE));
  const signedOut = await auth.api.signOut({ headers: request.headers, asResponse: true }).catch(() => null);
  const response = NextResponse.json({ ok: true }, { headers: signedOut?.headers });
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
  clearBetterAuthSessionCookies(response, cookieHeader);

  return response;
}
