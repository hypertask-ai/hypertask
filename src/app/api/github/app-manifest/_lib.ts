import { NextRequest, NextResponse } from "next/server";

import { getGithubConnectPrincipal, noStore } from "@/app/api/github/_lib";
import { FEATURE_FLAG_OWNER_USER_ID } from "@/lib/auth/ownerOrQaIds";
import {
  GITHUB_APP_MANIFEST_COOKIE,
  GITHUB_APP_MANIFEST_COOKIE_PATH,
  GITHUB_APP_MANIFEST_TTL_SECONDS,
} from "@/lib/github/appManifest";

export async function requireGithubAppManifestOwner(request: NextRequest): Promise<number | NextResponse> {
  const principal = await getGithubConnectPrincipal(request);
  if (principal.status === "unauthorized") return noStore({ error: "unauthorized" }, 401);
  if (principal.status === "error") return noStore({ error: "unavailable" }, 503);
  if (principal.status !== "allowed" || principal.userId !== FEATURE_FLAG_OWNER_USER_ID) {
    return noStore({ error: "not_found" }, 404);
  }
  return principal.userId;
}

export function manifestCookie(response: NextResponse, nonce: string): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(GITHUB_APP_MANIFEST_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: GITHUB_APP_MANIFEST_COOKIE_PATH,
    maxAge: nonce ? GITHUB_APP_MANIFEST_TTL_SECONDS : 0,
  });
  return response;
}
