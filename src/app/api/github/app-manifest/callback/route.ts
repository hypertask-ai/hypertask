import { NextRequest, NextResponse } from "next/server";

import { GITHUB_SETTINGS_PATH, noStore } from "@/app/api/github/_lib";
import { manifestCookie, requireGithubAppManifestOwner } from "@/app/api/github/app-manifest/_lib";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import prisma from "@/lib/prisma";
import { clearGithubAppConfigCache, hasGithubAppCredential } from "@/lib/github/appConfig";
import {
  consumeGithubAppManifestNonce,
  convertGithubAppManifest,
  GITHUB_APP_MANIFEST_COOKIE,
  verifyGithubAppManifestState,
} from "@/lib/github/appManifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const owner = await requireGithubAppManifestOwner(request);
  if (typeof owner !== "number") return owner;
  try {
    const state = verifyGithubAppManifestState(
      request.nextUrl.searchParams.get("state"),
      request.cookies.get(GITHUB_APP_MANIFEST_COOKIE)?.value,
      owner,
    );
    if (!state) return manifestCookie(noStore({ error: "invalid_state" }, 400), "");
    if (!(await consumeGithubAppManifestNonce(state.nonce))) {
      return manifestCookie(noStore({ error: "reused_state" }, 400), "");
    }
    if (await hasGithubAppCredential()) {
      return manifestCookie(noStore({ error: "already_registered" }, 409), "");
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code || !/^[A-Za-z0-9_-]{1,512}$/.test(code)) {
      return manifestCookie(noStore({ error: "invalid_code" }, 400), "");
    }
    const data = await convertGithubAppManifest(code, owner);
    const currentOwner = await requireGithubAppManifestOwner(request);
    if (typeof currentOwner !== "number") return manifestCookie(currentOwner, "");
    if (await hasGithubAppCredential()) {
      return manifestCookie(noStore({ error: "already_registered" }, 409), "");
    }
    await prisma.githubAppCredential.create({ data });
    clearGithubAppConfigCache();
    const destination = new URL(GITHUB_SETTINGS_PATH, getRequestBaseUrl(request));
    destination.searchParams.set("github_app", "registered");
    return manifestCookie(NextResponse.redirect(destination, 303), "");
  } catch (error) {
    const duplicate = error && typeof error === "object" && "code" in error && error.code === "P2002";
    return manifestCookie(noStore({ error: duplicate ? "already_registered" : "registration_failed" }, duplicate ? 409 : 502), "");
  }
}
