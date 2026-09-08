import { NextRequest, NextResponse } from "next/server";

import {
  getGoogleCalendarConnectPrincipal,
  googleCalendarRedirectUri,
  noStore,
  setOAuthAttemptCookie,
} from "@/app/api/google-calendar/_lib";
import {
  createGoogleCalendarOAuthAttempt,
  getGoogleCalendarOAuthConfig,
} from "@/lib/googleCalendar/oauth";
import {
  GOOGLE_CALENDAR_AUTHORIZE_URL,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_SETTINGS_PATH,
} from "@/lib/googleCalendar/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function settingsError(request: NextRequest, error: string): URL {
  const destination = new URL(GOOGLE_CALENDAR_SETTINGS_PATH, request.url);
  destination.searchParams.set("google_calendar_error", error);
  return destination;
}

export async function GET(request: NextRequest) {
  const principal = await getGoogleCalendarConnectPrincipal(request);
  if (principal.status === "unauthorized")
    return noStore({ error: "Unauthorized" }, 401);
  if (principal.status === "disabled")
    return noStore({ error: "Not found" }, 404);
  if (principal.status === "error")
    return noStore({ error: "Google Calendar is unavailable" }, 503);
  const config = getGoogleCalendarOAuthConfig();
  if (!config) {
    const response = NextResponse.redirect(
      settingsError(request, "not_configured"),
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const attempt = createGoogleCalendarOAuthAttempt(
    principal.userId,
    request.nextUrl.searchParams.get("returnTo"),
    config.clientSecret,
  );
  const authorizeUrl = new URL(GOOGLE_CALENDAR_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("code_challenge", attempt.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("include_granted_scopes", "true");
  authorizeUrl.searchParams.set("nonce", attempt.nonce);
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set(
    "redirect_uri",
    googleCalendarRedirectUri(request),
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  authorizeUrl.searchParams.set("state", attempt.state);

  const response = NextResponse.redirect(authorizeUrl);
  response.headers.set("Cache-Control", "private, no-store");
  setOAuthAttemptCookie(response, request, attempt.cookieValue);
  return response;
}
