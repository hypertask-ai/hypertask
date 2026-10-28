import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser, type SessionUser } from "@/lib/auth/getSessionUser";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import {
  FIGMA_CONNECTION_VERSION_COOKIE,
  FIGMA_OAUTH_CALLBACK_PATH,
} from "@/lib/figma/paths";
import {
  FIGMA_CONNECTION_VERSION_MAX_AGE_SECONDS,
  FIGMA_OAUTH_ATTEMPT_COOKIE,
  FIGMA_OAUTH_ATTEMPT_MAX_AGE_SECONDS,
} from "@/lib/figma/oauth";

export type FigmaAuthenticatedUser =
  | { status: "allowed"; userId: number; source: SessionUser["source"] }
  | { status: "error" }
  | { status: "unauthorized" };

export async function getFigmaAuthenticatedUser(
  request: NextRequest,
): Promise<FigmaAuthenticatedUser> {
  try {
    const session = await getSessionUser(request.headers);
    return session
      ? { status: "allowed", userId: session.userId, source: session.source }
      : { status: "unauthorized" };
  } catch {
    return { status: "error" };
  }
}

export function figmaRedirectUri(request: NextRequest): string {
  return new URL(
    FIGMA_OAUTH_CALLBACK_PATH,
    getRequestBaseUrl(request),
  ).toString();
}

export function noStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function trustedMutationOrigin(request: NextRequest): boolean {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export function setFigmaOAuthAttemptCookie(
  response: NextResponse,
  request: NextRequest,
  value: string,
): void {
  response.cookies.set(FIGMA_OAUTH_ATTEMPT_COOKIE, value, {
    httpOnly: true,
    maxAge: FIGMA_OAUTH_ATTEMPT_MAX_AGE_SECONDS,
    path: FIGMA_OAUTH_CALLBACK_PATH,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
}

export function clearFigmaOAuthAttemptCookie(response: NextResponse): void {
  response.cookies.set(FIGMA_OAUTH_ATTEMPT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: FIGMA_OAUTH_CALLBACK_PATH,
    sameSite: "lax",
  });
}

export function rotateFigmaConnectionVersion(
  response: NextResponse,
  request: NextRequest,
): void {
  response.cookies.set(
    FIGMA_CONNECTION_VERSION_COOKIE,
    randomBytes(16).toString("base64url"),
    {
      httpOnly: false,
      maxAge: FIGMA_CONNECTION_VERSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    },
  );
}

export function clearFigmaConnectionVersion(response: NextResponse): void {
  response.cookies.set(FIGMA_CONNECTION_VERSION_COOKIE, "", {
    httpOnly: false,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
}
