import { env as appEnv } from "#env";
import { withoutAuth } from "#with-auth";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  clearBetterAuthSessionCookies,
} from "@/lib/auth/session";

async function POSTHandler() {
  const response = NextResponse.json({ ok: true });
  const secure = appEnv.NODE_ENV === "production";

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

export const POST = withoutAuth(POSTHandler);
