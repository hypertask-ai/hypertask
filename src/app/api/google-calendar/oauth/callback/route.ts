import { NextRequest, NextResponse } from "next/server";

import {
  clearOAuthAttemptCookie,
  getGoogleCalendarConnectPrincipal,
  googleCalendarRedirectUri,
} from "@/app/api/google-calendar/_lib";
import {
  connectGoogleCalendarUser,
  GoogleAccountMismatchError,
} from "@/lib/googleCalendar/connection";
import { revokeGoogleToken } from "@/lib/googleCalendar/client";
import {
  exchangeGoogleCalendarCode,
  getGoogleCalendarOAuthConfig,
  GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE,
  verifyGoogleCalendarOAuthAttempt,
} from "@/lib/googleCalendar/oauth";
import { GOOGLE_CALENDAR_SETTINGS_PATH } from "@/lib/googleCalendar/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function finish(request: NextRequest, destination: string): NextResponse {
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  clearOAuthAttemptCookie(response);
  return response;
}

function fail(request: NextRequest, error: string): NextResponse {
  const destination = new URL(GOOGLE_CALENDAR_SETTINGS_PATH, request.url);
  destination.searchParams.set("google_calendar_error", error);
  return finish(request, destination.toString());
}

export async function GET(request: NextRequest) {
  const config = getGoogleCalendarOAuthConfig();
  if (!config) return fail(request, "not_configured");
  const attempt = verifyGoogleCalendarOAuthAttempt(
    request.cookies.get(GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE)?.value,
    request.nextUrl.searchParams.get("state"),
    config.clientSecret,
  );
  if (!attempt) return fail(request, "invalid_state");
  const principal = await getGoogleCalendarConnectPrincipal(request);
  if (principal.status !== "allowed") {
    return fail(
      request,
      principal.status === "unauthorized"
        ? "signed_out"
        : "feature_unavailable",
    );
  }
  if (principal.userId !== attempt.userId)
    return fail(request, "user_mismatch");
  if (request.nextUrl.searchParams.get("error"))
    return fail(request, "access_denied");
  const code = request.nextUrl.searchParams.get("code")?.trim();
  if (!code || code.length > 4096) return fail(request, "missing_code");

  let authorization: Awaited<
    ReturnType<typeof exchangeGoogleCalendarCode>
  > | null = null;
  try {
    authorization = await exchangeGoogleCalendarCode(
      {
        code,
        codeVerifier: attempt.codeVerifier,
        nonce: attempt.nonce,
        redirectUri: googleCalendarRedirectUri(request),
      },
      config,
    );
    await connectGoogleCalendarUser(principal.userId, authorization);
    return finish(request, attempt.returnTo);
  } catch (error) {
    if (authorization) {
      await revokeGoogleToken(
        authorization.refreshToken ?? authorization.accessToken,
      ).catch(() => {});
    }
    console.error(
      "Google Calendar OAuth callback failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return fail(
      request,
      error instanceof GoogleAccountMismatchError
        ? "google_account_mismatch"
        : "connection_failed",
    );
  }
}
