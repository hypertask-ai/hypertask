import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { figmaConnectEnabledFor } from "@/lib/figma/connection";
import { FIGMA_OAUTH_CALLBACK_PATH } from "@/lib/figma/paths";
import {
  FIGMA_CONNECTION_VERSION_COOKIE,
  FIGMA_CONNECTION_VERSION_MAX_AGE_SECONDS,
  FIGMA_OAUTH_ATTEMPT_COOKIE,
  FIGMA_OAUTH_ATTEMPT_MAX_AGE_SECONDS,
} from "@/lib/figma/oauth";

export type FigmaRequestUser =
  | { status: "allowed"; userId: number }
  | { status: "disabled" }
  | { status: "error" }
  | { status: "unauthorized" };

export async function getFigmaRequestUser(
  request: NextRequest,
): Promise<FigmaRequestUser> {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) return { status: "unauthorized" };
    return (await figmaConnectEnabledFor(session.userId))
      ? { status: "allowed", userId: session.userId }
      : { status: "disabled" };
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
      httpOnly: true,
      maxAge: FIGMA_CONNECTION_VERSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    },
  );
}

export function clearFigmaConnectionVersion(response: NextResponse): void {
  response.cookies.set(FIGMA_CONNECTION_VERSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
}
