import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7515-connect-github-per-board";
import {
  GITHUB_INSTALL_ATTEMPT_COOKIE,
  GITHUB_INSTALL_ATTEMPT_COOKIE_PATH,
  GITHUB_INSTALL_ATTEMPT_MAX_AGE_SECONDS,
} from "@/lib/github/oauthState";

export const GITHUB_SETTINGS_PATH = "/settings/github";
export const GITHUB_OAUTH_CALLBACK_PATH = "/api/github/oauth/callback";

export type GithubConnectPrincipal =
  | { status: "allowed"; userId: number }
  | { status: "disabled" }
  | { status: "error" }
  | { status: "unauthorized" };

export async function getGithubConnectPrincipal(
  request: NextRequest,
): Promise<GithubConnectPrincipal> {
  try {
    const session = await getSessionUser(request.headers);
    if (!session || session.agentId) return { status: "unauthorized" };
    const enabled = await isFeatureEnabled(
      HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG,
      session.userId,
    );
    return enabled ? { status: "allowed", userId: session.userId } : { status: "disabled" };
  } catch (error) {
    console.error(
      "GitHub connect principal lookup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return { status: "error" };
  }
}

export function noStore(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function refusePrincipal(
  principal: Exclude<GithubConnectPrincipal, { status: "allowed" }>,
): NextResponse {
  if (principal.status === "unauthorized") return noStore({ error: "Unauthorized" }, 401);
  if (principal.status === "disabled") return noStore({ error: "Not found" }, 404);
  return noStore({ error: "GitHub connect is unavailable" }, 503);
}

export const isTrustedMutationOrigin = (request: NextRequest) =>
  request.headers.get("origin") === new URL(getRequestBaseUrl(request)).origin;

export function githubCallbackUrl(request: NextRequest): string {
  return new URL(GITHUB_OAUTH_CALLBACK_PATH, getRequestBaseUrl(request)).toString();
}

export function redirectWithAttempt(
  request: NextRequest,
  destination: URL,
  nonce: string,
  status: 302 | 303,
): NextResponse {
  const response = NextResponse.redirect(destination, status);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(GITHUB_INSTALL_ATTEMPT_COOKIE, nonce, {
    httpOnly: true,
    maxAge: GITHUB_INSTALL_ATTEMPT_MAX_AGE_SECONDS,
    path: GITHUB_INSTALL_ATTEMPT_COOKIE_PATH,
    sameSite: "lax",
    secure: new URL(getRequestBaseUrl(request)).protocol === "https:",
  });
  return response;
}

export function finishAttempt(
  request: NextRequest,
  projectId: number | null,
  outcome: { status: "connected" | "pending" } | { error: string },
): NextResponse {
  const destination = new URL(GITHUB_SETTINGS_PATH, getRequestBaseUrl(request));
  if (projectId !== null) destination.searchParams.set("projectId", String(projectId));
  if ("status" in outcome) {
    destination.searchParams.set("github_status", outcome.status);
  } else {
    destination.searchParams.set("github_error", outcome.error);
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(GITHUB_INSTALL_ATTEMPT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: GITHUB_INSTALL_ATTEMPT_COOKIE_PATH,
    sameSite: "lax",
  });
  return response;
}

export function attemptCookieNonce(request: NextRequest): string | undefined {
  return request.cookies.get(GITHUB_INSTALL_ATTEMPT_COOKIE)?.value;
}
