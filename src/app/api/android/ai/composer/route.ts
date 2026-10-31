import { withAgentScopeRequest, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";
import {
  resolveTeamByokApiKey,
  getAiDefaultModelContext,
  resolveTeamCustomEndpoint,
} from "@/app/api/ai/_lib/byokKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { HTPR_7939_GROK_GEMINI4_MODELS_FLAG } from "@/lib/flags/keys";
import { buildComposerConfig, providersRequiringByokCheck } from "./config";
import { isFeatureEnabled } from "@/lib/flags";
import { aiProvidersForSavedByokKeys } from "@/lib/ai/teamAiFunding";

function error(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function GET(request: NextRequest) {
  return withAgentScopeRequest(request, () => getComposer(request));
}

async function getComposer(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) return error("Unauthorized. Invalid or missing authentication token.", 401);

    const projectId = Number(request.nextUrl.searchParams.get("project_id"));
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return error("project_id is required", 400);
    }
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: { id: true, teamId: true },
    });
    if (!project) return error("Project not found or access denied", 404);
    recordAgentBoardScopeMiss(project.id, "read");
    if (!project.teamId) return error("This board has no team AI settings", 409);

    const lookup = await getTeamAiSettingsForViewer(
      ctx.user.id,
      undefined,
      project.teamId,
    );
    if (!lookup.ok) return error(lookup.message, lookup.status);

    const [customEndpoint, storePlanId, gatewayCredential, providerCredentials] = await Promise.all([
      resolveTeamCustomEndpoint({ trustedTeamId: project.teamId }),
      storePlanIdForProject(project.id, project.teamId),
      resolveTeamByokApiKey("gateway", { trustedTeamId: project.teamId }),
      Promise.all(
        providersRequiringByokCheck().map(async ({ provider, byokKey }) => ({
          provider,
          configured: byokKey
            ? Boolean(
                await resolveTeamByokApiKey(byokKey, {
                  trustedTeamId: project.teamId,
                }),
              )
            : false,
        })),
      ),
    ]);
    const defaultContext = await getAiDefaultModelContext({ trustedTeamId: project.teamId, userId: ctx.user.id }, undefined, storePlanId);
    const providersWithByok = new Set(
      providerCredentials
        .filter(
          ({ configured }) =>
            (!defaultContext.haiku55Enabled || storePlanId !== "Free") &&
            (configured || (storePlanId === "BYOK" && Boolean(gatewayCredential))),
        )
        .map(({ provider }) => provider),
    );
    if (defaultContext.byok) {
      providersWithByok.add(
        defaultContext.byok.provider === "openrouter" ? "openrouter" : "anthropic",
      );
    }
    const grokGemini4Enabled = await import("@/lib/flags")
      .then(({ isFeatureEnabled }) => isFeatureEnabled(HTPR_7939_GROK_GEMINI4_MODELS_FLAG, ctx.user.id))
      .catch(() => false);
    const keyOnly = Boolean(lookup.aiKeyOnly);
    if (keyOnly && (!Number.isSafeInteger(lookup.ownerUserId) || lookup.ownerUserId <= 0 ||
      !await isFeatureEnabled("htpr-7844-team-ai-key-only", lookup.ownerUserId))) {
      return error("Team AI is paused.", 503);
    }
    return NextResponse.json({
      success: true,
      projectId: project.id,
      ...buildComposerConfig({
        settings: lookup.settings,
        customEndpointConfigured: Boolean(customEndpoint),
        storePlanId,
        providersWithByok,
        haiku55Enabled: defaultContext.haiku55Enabled,
        grokGemini4Enabled,
        haikuDefaultEnabled: defaultContext.haikuDefaultEnabled,
        defaultContext,
        keyOnlySavedProviders: keyOnly ? aiProvidersForSavedByokKeys(lookup.savedByokProviders ?? []) : null,
      }),
    });
  } catch (cause) {
    console.error("[Android AI Composer] Error:", cause);
    return error("Internal server error", 500);
  }
}
