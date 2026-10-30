import { NextRequest, NextResponse } from "next/server";
import {
  wrapMcpRoute,
  validateMcpRouteAuth,
  checkMcpRouteRateLimit,
  mcpRouteUnauthorizedResponse,
  withMcpRouteMutationLease,
} from "@/lib/mcp/routeWrapper";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { findIdParamOutOfRange, idOutOfRangeMessage } from "@/lib/mcp/listParams";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8216_AGENT_TASK_SHARE_FLAG } from "@/lib/flags/definitions/htpr-8216-agent-task-share";
import { readTaskShare, shareTaskWithLink } from "@/lib/tasks/taskSharing";
import prisma from "@/lib/prisma";

const taskIdFromQuery = (request: NextRequest) => {
  const raw = request.nextUrl.searchParams.get("taskId");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const taskId = Number(raw);
  return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null;
};

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) return await mcpRouteUnauthorizedResponse(request);
      if (!(await isFeatureEnabled(HTPR_8216_AGENT_TASK_SHARE_FLAG, ctx.user.id))) {
        return NextResponse.json({ success: false, error: "Ticket sharing is not enabled" }, { status: 404 });
      }
      const taskId = taskIdFromQuery(request);
      if (taskId === null) {
        return NextResponse.json(
          { success: false, error: "taskId must be a positive integer", code: "invalid_field" },
          { status: 400 },
        );
      }
      const outOfRange = findIdParamOutOfRange({ taskId });
      if (outOfRange) {
        return NextResponse.json({ success: false, error: idOutOfRangeMessage(outOfRange), code: "invalid_field" }, { status: 400 });
      }
      const result = await readTaskShare({
        taskId,
        currentUser: { id: ctx.user.id },
        agentId: ctx.agentId,
        teamScope: ctx.teamScope,
      });
      if ("message" in result.body) {
        return NextResponse.json({ success: false, error: result.body.message }, { status: result.status });
      }
      return NextResponse.json({ success: true, share: result.body }, { status: result.status });
    } catch (error) {
      console.error("/api/mcp/tasks/share", error);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
  })(request);
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) return await mcpRouteUnauthorizedResponse(request);
      const roleRefusal = await requireAgentWriteRole(ctx);
      if (roleRefusal) return roleRefusal;
      if (!(await isFeatureEnabled(HTPR_8216_AGENT_TASK_SHARE_FLAG, ctx.user.id))) {
        return NextResponse.json({ success: false, error: "Ticket sharing is not enabled" }, { status: 404 });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ success: false, error: "Invalid request body", message: "Request body must be valid JSON" }, { status: 400 });
      }
      if (!body || Array.isArray(body) || typeof body.taskId !== "number" || !Number.isInteger(body.taskId)) {
        return NextResponse.json({ success: false, error: "Provide an integer taskId" }, { status: 400 });
      }
      const outOfRange = findIdParamOutOfRange({ taskId: body.taskId });
      if (outOfRange) {
        return NextResponse.json({ success: false, error: idOutOfRangeMessage(outOfRange), code: "invalid_field" }, { status: 400 });
      }

      const currentUser = await loadSessionUserRecord(ctx.user.id);
      const result = await withMcpRouteMutationLease(
        prisma,
        { agentId: ctx.agentId, userId: ctx.user.id },
        () => shareTaskWithLink({
          taskId: body.taskId,
          currentUser,
          agentId: ctx.agentId,
          teamScope: ctx.teamScope,
        }),
      );
      if ("message" in result.body) {
        return NextResponse.json({ success: false, error: result.body.message }, { status: result.status });
      }
      return NextResponse.json({ success: true, share: result.body }, { status: result.status });
    } catch (error) {
      console.error("/api/mcp/tasks/share", error);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
  })(request);
}
