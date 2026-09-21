import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";
import {
  resolveTeamByokApiKey,
  resolveTeamCustomEndpoint,
} from "@/app/api/ai/_lib/byokKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { buildComposerConfig, providersRequiringByokCheck } from "./config";

function error(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Board-scoped model and feature capabilities for the native Android AI composer. */
export async function GET(request: NextRequest) {
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
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId) },
      select: { id: true, teamId: true },
    });
    if (!project) return error("Project not found or access denied", 404);
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
    const providersWithByok = new Set(
      providerCredentials
        .filter(
          ({ configured }) =>
            configured || (storePlanId === "BYOK" && Boolean(gatewayCredential)),
        )
        .map(({ provider }) => provider),
    );
    return NextResponse.json({
      success: true,
      projectId: project.id,
      ...buildComposerConfig({
        settings: lookup.settings,
        customEndpointConfigured: Boolean(customEndpoint),
        storePlanId,
        providersWithByok,
      }),
    });
  } catch (cause) {
    console.error("[Android AI Composer] Error:", cause);
    return error("Internal server error", 500);
  }
}
