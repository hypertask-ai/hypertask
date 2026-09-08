import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { googleCalendarEnabledFor } from "@/lib/googleCalendar/connection";
import {
  GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE,
  GOOGLE_CALENDAR_OAUTH_ATTEMPT_MAX_AGE_SECONDS,
} from "@/lib/googleCalendar/oauth";
import { GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH } from "@/lib/googleCalendar/paths";

export type GoogleCalendarPrincipal =
  | { status: "allowed"; userId: number }
  | { status: "error" }
  | { status: "unauthorized" };

export async function getGoogleCalendarPrincipal(
  request: NextRequest,
): Promise<GoogleCalendarPrincipal> {
  try {
    const session = await getSessionUser(request.headers);
    return session
      ? { status: "allowed", userId: session.userId }
      : { status: "unauthorized" };
  } catch (error) {
    console.error("Google Calendar session lookup failed", error);
    return { status: "error" };
  }
}

export async function getGoogleCalendarConnectPrincipal(request: NextRequest) {
  const principal = await getGoogleCalendarPrincipal(request);
  if (principal.status !== "allowed") return principal;
  try {
    return (await googleCalendarEnabledFor(principal.userId))
      ? principal
      : ({ status: "disabled" } as const);
  } catch (error) {
    console.error("Google Calendar feature lookup failed", error);
    return { status: "error" } as const;
  }
}

export function googleCalendarRedirectUri(request: NextRequest): string {
  return new URL(
    GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH,
    getRequestBaseUrl(request),
  ).toString();
}

export function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const trustedMutationOrigin = (request: NextRequest) =>
  request.headers.get("origin") === request.nextUrl.origin;

export function setOAuthAttemptCookie(
  response: NextResponse,
  request: NextRequest,
  value: string,
): void {
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE, value, {
    httpOnly: true,
    maxAge: GOOGLE_CALENDAR_OAUTH_ATTEMPT_MAX_AGE_SECONDS,
    path: GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
}

export function clearOAuthAttemptCookie(response: NextResponse): void {
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH,
    sameSite: "lax",
  });
}
