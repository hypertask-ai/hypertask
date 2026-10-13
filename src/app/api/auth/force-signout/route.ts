import { NextResponse } from "next/server";
import { parseCookies } from "better-auth/cookies";
import { revokeSessionToken } from "@/lib/auth/sessionRevocation";
import {
  SESSION_COOKIE,
  clearBetterAuthSessionCookies,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  await revokeSessionToken(parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  const response = NextResponse.json({ ok: true });
  const body = await request.json().catch(() => null);
  if (body?.revokeOnly === true) return response;
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
