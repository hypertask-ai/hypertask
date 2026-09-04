import { NextRequest, NextResponse } from "next/server";

import {
  figmaRedirectUri,
  getFigmaRequestUser,
  noStore,
  setFigmaOAuthAttemptCookie,
} from "@/app/api/figma/_lib";
import {
  createFigmaOAuthAttempt,
  getFigmaOAuthConfig,
} from "@/lib/figma/oauth";
import {
  FIGMA_AUTHORIZE_URL,
  FIGMA_SETTINGS_PATH,
} from "@/lib/figma/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function settingsError(request: NextRequest, error: string): URL {
  const destination = new URL(FIGMA_SETTINGS_PATH, request.url);
  destination.searchParams.set("figma_error", error);
  return destination;
}

export async function GET(request: NextRequest) {
  const principal = await getFigmaRequestUser(request);
  if (principal.status === "unauthorized") {
    return noStore({ error: "Unauthorized" }, 401);
  }
  if (principal.status === "disabled") {
    return noStore({ error: "Not found" }, 404);
  }
  if (principal.status === "error") {
    return noStore({ error: "Figma connection is unavailable" }, 503);
  }

  const config = getFigmaOAuthConfig();
  if (!config) {
    return NextResponse.redirect(settingsError(request, "not_configured"));
  }

  const attempt = createFigmaOAuthAttempt(
    principal.userId,
    request.nextUrl.searchParams.get("returnTo"),
    config.clientSecret,
  );
  const authorizeUrl = new URL(FIGMA_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", figmaRedirectUri(request));
  authorizeUrl.searchParams.set("scope", "file_content:read");
  authorizeUrl.searchParams.set("state", attempt.state);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", attempt.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  response.headers.set("Cache-Control", "private, no-store");
  setFigmaOAuthAttemptCookie(response, request, attempt.cookieValue);
  return response;
}
