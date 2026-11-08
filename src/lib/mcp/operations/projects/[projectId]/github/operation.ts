import { NextRequest, NextResponse } from "next/server";

import { createUnauthorizedResponse } from "@/lib/mcp/auth";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7515-connect-github-per-board";
import {
  BoardGithubSettingsError,
  getBoardGithubSettings,
  saveBoardGithubRepositories,
} from "@/lib/github/boardRepositories";
import {
  checkMcpRouteRateLimit as checkMcpRateLimit,
  validateMcpRouteAuth as validateMcpAuth,
  wrapMcpRoute,
} from "@/lib/mcp/routeWrapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseProjectId(raw: string): number {
  const projectId = Number(raw);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("projectId must be a positive integer");
  }
  return projectId;
}

async function requireFlag(userId: number) {
  if (!await isFeatureEnabled(HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG, userId)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> },
) {
  return wrapMcpRoute(async (request: NextRequest) => {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) return createUnauthorizedResponse();

    const flagRefusal = await requireFlag(ctx.user.id);
    if (flagRefusal) return flagRefusal;

    try {
      const { projectId: rawProjectId } = await props.params;
      const projectId = parseProjectId(rawProjectId);
      const settings = await getBoardGithubSettings(ctx.user.id, projectId);
      return NextResponse.json({ success: true, ...settings });
    } catch (error) {
      if (error instanceof BoardGithubSettingsError) {
        return NextResponse.json({
          success: false,
          error: error.error,
          ...(error.repositoryIds ? { repositoryIds: error.repositoryIds } : {}),
        }, { status: error.status });
      }
      const message = error instanceof Error ? error.message : "Failed to read GitHub settings";
      const status = message.includes("access denied") ? 403 : 400;
      return NextResponse.json({ success: false, error: message }, { status });
    }
  })(request);
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> },
) {
  return wrapMcpRoute(async (request: NextRequest) => {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) return createUnauthorizedResponse();
    const roleRefusal = await requireAgentWriteRole(ctx);
    if (roleRefusal) return roleRefusal;

    const flagRefusal = await requireFlag(ctx.user.id);
    if (flagRefusal) return flagRefusal;

    try {
      const { projectId: rawProjectId } = await props.params;
      const projectId = parseProjectId(rawProjectId);
      const body = await request.json();
      const settings = await saveBoardGithubRepositories(ctx.user.id, projectId, body);
      return NextResponse.json({ success: true, ...settings });
    } catch (error) {
      if (error instanceof BoardGithubSettingsError) {
        return NextResponse.json({
          success: false,
          error: error.error,
          ...(error.repositoryIds ? { repositoryIds: error.repositoryIds } : {}),
        }, { status: error.status });
      }
      const message = error instanceof Error ? error.message : "Failed to save GitHub settings";
      const status = message.includes("access denied") ? 403 : 400;
      return NextResponse.json({ success: false, error: message }, { status });
    }
  })(request);
}
