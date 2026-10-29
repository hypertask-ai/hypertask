import { NextResponse } from "next/server";
import type { ForceSignOutResult } from "@/lib/auth/session";
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
  const signedOut = await auth.api.signOut({ headers: request.headers, asResponse: true }).catch((error) => {
    console.error("Better Auth session revocation failed during browser sign-out:", error);
    return null;
  });
  if (signedOut && !signedOut.ok) {
    console.error("Better Auth session revocation failed during browser sign-out:", signedOut.status);
  }
  const response = NextResponse.json<ForceSignOutResult>({
    browserCookiesCleared: true,
    serverSessionsRevoked: signedOut?.ok === true,
  }, { headers: signedOut?.headers });
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
