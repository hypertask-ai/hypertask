import { NextRequest, NextResponse } from "next/server";

import {
  clearBetterAuthSessionCookies,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { isGuestRequest } from "@/lib/demo/guestGuard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/demo", request.url), 307);
  const isGuest = await isGuestRequest({
    cookies: {
      [SESSION_COOKIE]: request.cookies.get(SESSION_COOKIE)?.value,
    },
  });

  if (!isGuest) return response;

  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  response.cookies.set("nookies_user", "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  clearBetterAuthSessionCookies(response);

  if (request.cookies.has("signup_source")) {
    response.cookies.set("signup_source", "", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
