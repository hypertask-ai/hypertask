import { NextRequest, NextResponse } from "next/server";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { isOwnKeyOnlySettings } from "@/lib/ai/forcedTeamKey";
import { DUPLICATE_DECISION_MODEL_SLUG } from "@/lib/ai/jevDuplicateHint";
import { isGdprSafeModeEnabled } from "@/lib/aiProviders";
import { reportError } from "@/lib/errors/reportError";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9046_JEV_DUPLICATE_HINT_FLAG } from "@/lib/flags/definitions/htpr-9046-jev-duplicate-hint";
import type { McpAuthContext } from "@/lib/mcp/auth";
import {
  checkMcpRouteRateLimit,
  validateMcpRouteAuth,
  wrapMcpRoute,
} from "@/lib/mcp/routeWrapper";
import prisma from "@/lib/prisma";
import { providerRows } from "@/utils/controllers/teams/aiProviderSettingsView";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

type TeamResolution =
  | { teamId: string }
  | { error: string; status: 400 | 403 };

async function resolveTeamId(
  ctx: McpAuthContext,
  requestedTeamId: string | null,
): Promise<TeamResolution> {
  if (requestedTeamId && !UUID_PATTERN.test(requestedTeamId)) {
    return { error: "team_id must be a valid UUID", status: 400 };
  }

  const scopedTeamId = ctx.teamScope?.teamId ?? ctx.management?.teamId ?? null;
  if (scopedTeamId && requestedTeamId && requestedTeamId !== scopedTeamId) {
    return {
      error: "A team-scoped key can read AI settings only for its own team.",
      status: 403,
    };
  }
  if (scopedTeamId) return { teamId: scopedTeamId };
  if (requestedTeamId) return { teamId: requestedTeamId };

  const owned = await prisma.team.findMany({
    where: { googleAccount: { userId: ctx.user.id } },
    select: { id: true },
    take: 2,
  });
  if (owned.length === 1) return { teamId: owned[0].id };

  return {
    error:
      owned.length > 1
        ? "team_id is required when you own more than one team"
        : "team_id is required",
    status: 400,
  };
}

export const GET = wrapMcpRoute(async (request: NextRequest) => {
  const rateLimited = await checkMcpRouteRateLimit(request);
  if (rateLimited) {
    rateLimited.headers.set("Cache-Control", "private, no-store");
    return rateLimited;
  }

  const ctx = await validateMcpRouteAuth(request);
  if (!ctx) {
    return reply(
      { success: false, error: "Invalid or missing authentication token." },
      401,
    );
  }

  try {
    const requestedTeamId = request.nextUrl.searchParams.get("team_id")?.trim() || null;
    const resolution = await resolveTeamId(ctx, requestedTeamId);
    if (!("teamId" in resolution)) {
      return reply({ success: false, error: resolution.error }, resolution.status);
    }
    const teamId = resolution.teamId;

    const account = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { accountId: true },
    });
    if (!account) {
      return reply({ success: false, error: "Unauthorized" }, 401);
    }

    const lookup = await getTeamAiSettingsForViewer(
      ctx.user.id,
      account.accountId ?? undefined,
      teamId,
    );
    if (!lookup.ok) {
      return reply({ success: false, error: lookup.message }, lookup.status);
    }

    const funding = await getTeamGatewayFunding({
      trustedTeamId: teamId,
      projectId: null,
      userId: ctx.user.id,
      agentId: ctx.agentId,
      teamScope: ctx.teamScope,
    }).catch(() => undefined);

    return reply({
      success: true,
      teamId,
      gdprSafeMode: isGdprSafeModeEnabled(lookup.settings),
      ownKeyOnly: isOwnKeyOnlySettings(lookup.settings),
      providers: providerRows(lookup.settings),
      gateway: {
        configured: Boolean(funding),
        source: funding?.source ?? null,
      },
      jev: {
        flag: HTPR_9046_JEV_DUPLICATE_HINT_FLAG,
        model: DUPLICATE_DECISION_MODEL_SLUG,
        enabled: await isFeatureEnabled(
          HTPR_9046_JEV_DUPLICATE_HINT_FLAG,
          ctx.user.id,
        ),
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "AI settings read failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/mcp/ai/settings",
      source: "handled",
      extra: { stage: "request" },
    });
    return reply({ success: false, error: "AI settings are unavailable" }, 503);
  }
});
