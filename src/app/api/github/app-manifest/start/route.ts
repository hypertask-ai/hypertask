import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { noStore } from "@/app/api/github/_lib";
import { manifestCookie, requireGithubAppManifestOwner } from "@/app/api/github/app-manifest/_lib";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { hasGithubAppCredential } from "@/lib/github/appConfig";
import { createGithubAppManifestState, githubAppManifest } from "@/lib/github/appManifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeAttribute(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export async function GET(request: NextRequest) {
  const owner = await requireGithubAppManifestOwner(request);
  if (typeof owner !== "number") return owner;
  try {
    if (await hasGithubAppCredential()) return noStore({ error: "already_registered" }, 409);
    const limited = await checkRestRateLimit(owner, "write");
    if (limited) {
      limited.headers.set("Cache-Control", "private, no-store");
      return limited;
    }
    const attempt = createGithubAppManifestState(owner);
    const action = new URL("https://github.com/organizations/hypertask-ai/settings/apps/new");
    action.searchParams.set("state", attempt.state);
    const manifest = JSON.stringify(githubAppManifest(new URL(getRequestBaseUrl(request)).origin));
    const scriptNonce = randomBytes(16).toString("base64");
    const response = new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register Hypertask GitHub App</title></head><body><form method="post" action="${escapeAttribute(action.toString())}"><input type="hidden" name="manifest" value="${escapeAttribute(manifest)}"><button type="submit">Create Hypertask GitHub App</button></form><script nonce="${scriptNonce}">document.forms[0].submit()</script></body></html>`, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${scriptNonce}'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'`,
        "X-Content-Type-Options": "nosniff",
      },
    });
    return manifestCookie(response, attempt.nonce);
  } catch {
    return noStore({ error: "unavailable" }, 503);
  }
}
