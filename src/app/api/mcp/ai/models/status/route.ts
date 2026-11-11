import { NextRequest, NextResponse } from "next/server";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { isOwnKeyOnlySettings } from "@/lib/ai/forcedTeamKey";
import { DUPLICATE_DECISION_MODEL_SLUG } from "@/lib/ai/jevDuplicateHint";
import { readModelCanaryStatus } from "@/lib/ai/modelCanary";
import { isGdprSafeModeEnabled } from "@/lib/aiProviders";
import { reportError } from "@/lib/errors/reportError";
import { MODEL_CANARY_STATE_FLAG, isFeatureEnabled } from "@/lib/flags";
import { HTPR_9046_JEV_DUPLICATE_HINT_FLAG } from "@/lib/flags/definitions/htpr-9046-jev-duplicate-hint";
import { wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit } from "@/lib/mcp/routeWrapper";
import prisma from "@/lib/prisma";
import { providerRows } from "@/utils/controllers/teams/aiProviderSettingsView";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

type AuthContext = NonNullable<Awaited<ReturnType<typeof validateMcpRouteAuth>>>;

async function resolveTeamId(ctx: AuthContext, requested: string | null) {
  const scoped = ctx.teamScope?.teamId ?? ctx.management?.teamId ?? null;
  if (scoped) return requested && requested !== scoped ? null : scoped;
  if (requested) return requested;
  const owned = await prisma.team.findMany({
    where: { googleAccount: { userId: ctx.user.id } },
    select: { id: true },
    take: 2,
  });
  return owned.length === 1 ? owned[0].id : null;
}

async function readSettings(ctx: AuthContext, request: NextRequest) {
  const jevEnabled = await isFeatureEnabled(
    HTPR_9046_JEV_DUPLICATE_HINT_FLAG,
    ctx.user.id,
  );
  const jev = {
    flag: HTPR_9046_JEV_DUPLICATE_HINT_FLAG,
    model: DUPLICATE_DECISION_MODEL_SLUG,
    enabled: jevEnabled,
  };
  try {
    const teamId = await resolveTeamId(
      ctx,
      request.nextUrl.searchParams.get("team_id")?.trim() || null,
    );
    if (!teamId) return { teamId: null, gateway: null, jev };

    const account = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { accountId: true },
    });
    const lookup = await getTeamAiSettingsForViewer(
      ctx.user.id,
      account?.accountId ?? undefined,
      teamId,
    );
    if (!lookup.ok) return { teamId: null, gateway: null, jev };

    const funding = await getTeamGatewayFunding({
      trustedTeamId: teamId,
      projectId: null,
      userId: ctx.user.id,
      agentId: ctx.agentId,
      teamScope: ctx.teamScope,
    }).catch(() => undefined);

    return {
      teamId,
      gdprSafeMode: isGdprSafeModeEnabled(lookup.settings),
      ownKeyOnly: isOwnKeyOnlySettings(lookup.settings),
      providers: providerRows(lookup.settings),
      gateway: { configured: Boolean(funding), source: funding?.source ?? null },
      jev,
    };
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "AI settings read failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/mcp/ai/models/status",
      source: "handled",
      extra: { stage: "settings" },
    });
    return { teamId: null, gateway: null, providers: [], jev, unreadable: true };
  }
}

export const GET = wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRouteRateLimit(request);
    if (rateLimited) {
      rateLimited.headers.set("Cache-Control", headers["Cache-Control"]);
      return rateLimited;
    }
    const ctx = await validateMcpRouteAuth(request);
    if (!ctx) {
      return NextResponse.json({ success: false, error: "Invalid or missing authentication token." }, { status: 401, headers });
    }
    const status = await readModelCanaryStatus();
    if (!await isFeatureEnabled(MODEL_CANARY_STATE_FLAG, ctx.user.id)) {
      return NextResponse.json({ success: true, checkedAt: status.checkedAt, models: status.models }, { headers });
    }
    return NextResponse.json({ success: true, ...status, settings: await readSettings(ctx, request) }, { headers });
  } catch (error) {
    await reportError({
      message: error instanceof Error ? error.message : "AI request failed",
      stack: error instanceof Error ? error.stack : undefined,
      url: "/api/mcp/ai/models/status",
      source: "handled",
      extra: { stage: "request" },
    });
    return NextResponse.json({ success: false, error: "Model status is unavailable" }, { status: 503, headers });
  }
});
