import { NextRequest } from "next/server";

import { getGithubConnectPrincipal, isTrustedMutationOrigin, noStore } from "@/app/api/github/_lib";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import {
  BoardGithubSettingsError,
  getBoardGithubSettings,
  saveBoardGithubRepositories,
} from "@/lib/github/boardRepositories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

async function handle(request: NextRequest, context: RouteContext, mutation: boolean) {
  const principal = await getGithubConnectPrincipal(request);
  if (principal.status === "unauthorized") return noStore({ error: "not_signed_in" }, 401);
  if (principal.status === "disabled") return noStore({ error: "not_found" }, 404);
  if (principal.status !== "allowed") return noStore({ error: "github_unavailable" }, 503);
  if (mutation && !isTrustedMutationOrigin(request)) return noStore({ error: "forbidden" }, 403);
  const { projectId: rawProjectId } = await context.params;
  const projectId = /^[1-9][0-9]{0,9}$/.test(rawProjectId) ? Number(rawProjectId) : NaN;
  if (!Number.isSafeInteger(projectId) || projectId > 2147483647) return noStore({ error: "not_found" }, 404);
  let body: unknown;
  if (mutation) {
    try {
      body = await request.json();
    } catch {
      return noStore({ error: "invalid" }, 400);
    }
  }
  const limited = await checkRestRateLimit(principal.userId, mutation ? "write" : "read");
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }
  try {
    const settings = mutation
      ? await saveBoardGithubRepositories(principal.userId, projectId, body)
      : await getBoardGithubSettings(principal.userId, projectId);
    return noStore(settings, 200);
  } catch (error) {
    if (error instanceof BoardGithubSettingsError) {
      return noStore({
        error: error.error,
        ...(error.repositoryIds ? { repositoryIds: error.repositoryIds } : {}),
      }, error.status);
    }
    return noStore({ error: "github_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context, false);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context, true);
}
