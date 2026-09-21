import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  clearBetterAuthSessionCookies,
} from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
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
