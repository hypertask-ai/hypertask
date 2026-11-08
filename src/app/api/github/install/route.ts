import { NextRequest } from "next/server";

import {
  getGithubConnectPrincipal,
  isTrustedMutationOrigin,
  noStore,
  redirectWithAttempt,
  refusePrincipal,
} from "@/app/api/github/_lib";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { getGithubAppConfig } from "@/lib/github/appConfig";
import { findBoardGithubAdmin } from "@/lib/github/installAuthority";
import { createGithubInstallAttempt } from "@/lib/github/oauthState";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readProjectId(request: NextRequest): Promise<number | null> {
  let value: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("application/json")) {
      const body = (await request.json()) as { projectId?: unknown } | null;
      value = body?.projectId;
    } else if (contentType.startsWith("application/x-www-form-urlencoded")) {
      value = (await request.formData()).get("projectId");
    }
  } catch {
    return null;
  }
  const projectId =
    typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : value;
  return typeof projectId === "number" && Number.isSafeInteger(projectId) && projectId > 0
    ? projectId
    : null;
}

export async function POST(request: NextRequest) {
  const principal = await getGithubConnectPrincipal(request);
  if (principal.status !== "allowed") return refusePrincipal(principal);
  if (principal.source !== "cli-bearer" && !isTrustedMutationOrigin(request)) return noStore({ error: "Forbidden" }, 403);

  const projectId = await readProjectId(request);
  if (projectId === null) return noStore({ error: "A board projectId is required" }, 400);

  const config = getGithubAppConfig();
  if (!config) return noStore({ error: "GitHub is not configured" }, 503);

  const admin = await findBoardGithubAdmin(principal.userId, projectId);
  if (!admin) {
    return noStore(
      { error: "Only the board owner, a board admin in this team or the team owner can connect GitHub" },
      403,
    );
  }

  const limited = await checkRestRateLimit(principal.userId, "write");
  if (limited) return limited;

  const attempt = createGithubInstallAttempt(
    {
      installationId: null,
      phase: "install",
      projectId: admin.projectId,
      teamId: admin.teamId,
      userId: principal.userId,
    },
    config.stateSecret,
  );
  const installUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`,
  );
  installUrl.searchParams.set("state", attempt.state);
  return redirectWithAttempt(request, installUrl, attempt.nonce, 303);
}
