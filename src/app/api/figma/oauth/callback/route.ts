import { NextRequest, NextResponse } from "next/server";

import {
  clearFigmaOAuthAttemptCookie,
  figmaRedirectUri,
  getFigmaRequestUser,
  rotateFigmaConnectionVersion,
} from "@/app/api/figma/_lib";
import { connectFigmaUser } from "@/lib/figma/connection";
import { FIGMA_SETTINGS_PATH } from "@/lib/figma/paths";
import {
  exchangeFigmaCode,
  FIGMA_OAUTH_ATTEMPT_COOKIE,
  getFigmaOAuthConfig,
  getFigmaUserName,
  verifyFigmaOAuthAttempt,
} from "@/lib/figma/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function finish(
  request: NextRequest,
  destination: string,
  connected = false,
): NextResponse {
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  clearFigmaOAuthAttemptCookie(response);
  if (connected) rotateFigmaConnectionVersion(response, request);
  return response;
}

function fail(request: NextRequest, error: string): NextResponse {
  const destination = new URL(FIGMA_SETTINGS_PATH, request.url);
  destination.searchParams.set("figma_error", error);
  return finish(request, destination.toString());
}

export async function GET(request: NextRequest) {
  const config = getFigmaOAuthConfig();
  if (!config) return fail(request, "not_configured");

  const attempt = verifyFigmaOAuthAttempt(
    request.cookies.get(FIGMA_OAUTH_ATTEMPT_COOKIE)?.value,
    request.nextUrl.searchParams.get("state"),
    config.clientSecret,
  );
  if (!attempt) return fail(request, "invalid_state");

  const principal = await getFigmaRequestUser(request);
  if (principal.status !== "allowed") {
    return fail(
      request,
      principal.status === "unauthorized" ? "signed_out" : "feature_unavailable",
    );
  }
  if (principal.userId !== attempt.userId) {
    return fail(request, "user_mismatch");
  }

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return fail(request, "access_denied");
  const code = request.nextUrl.searchParams.get("code")?.trim();
  if (!code || code.length > 4096) return fail(request, "missing_code");

  try {
    await connectFigmaUser(principal.userId, async () => {
      const token = await exchangeFigmaCode(
        {
          code,
          codeVerifier: attempt.codeVerifier,
          redirectUri: figmaRedirectUri(request),
        },
        config,
      );
      if (!token.refreshToken || !token.userId) {
        throw new Error("Figma OAuth returned an incomplete token");
      }
      const figmaUserName = await getFigmaUserName(token.accessToken).catch(
        () => null,
      );
      return { ...token, figmaUserName } as typeof token & {
        figmaUserName: string | null;
        refreshToken: string;
        userId: string;
      };
    });
    return finish(request, attempt.returnTo, true);
  } catch (error) {
    console.error(
      "Figma OAuth callback failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return fail(request, "connection_failed");
  }
}
