import { NextRequest, NextResponse } from "next/server";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import {
  wrapMcpRoute,
  validateMcpRouteAuth,
  checkMcpRouteRateLimit,
  mcpRouteUnauthorizedResponse,
  withMcpRouteMutationLease,
} from "@/lib/mcp/routeWrapper";
import { findIdParamOutOfRange, idOutOfRangeMessage } from "@/lib/mcp/listParams";
import { setTaskWaitingOn } from "@/lib/tasks/setWaitingOn";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) return await mcpRouteUnauthorizedResponse(request);
      const roleRefusal = await requireAgentWriteRole(ctx);
      if (roleRefusal) return roleRefusal;

      let body;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ success: false, error: "Invalid request body", message: "Request body must be valid JSON" }, { status: 400 });
      }
      if (!body || Array.isArray(body) || typeof body.taskId !== "number" || !Number.isInteger(body.taskId)
        || (body.userId !== null && (typeof body.userId !== "number" || !Number.isInteger(body.userId)))) {
        return NextResponse.json({ success: false, error: "taskId must be an integer and userId must be an integer or null" }, { status: 400 });
      }
      const outOfRange = findIdParamOutOfRange({ taskId: body.taskId, userId: body.userId });
      if (outOfRange) {
        return NextResponse.json({ success: false, error: idOutOfRangeMessage(outOfRange), code: "invalid_field" }, { status: 400 });
      }

      const currentUser = await loadSessionUserRecord(ctx.user.id);
      const result = await withMcpRouteMutationLease(
        prisma,
        { agentId: ctx.agentId, userId: ctx.user.id },
        () => setTaskWaitingOn({
          taskId: body.taskId,
          userId: body.userId,
          currentUser,
          agentId: ctx.agentId,
          teamScope: ctx.teamScope,
        }),
      );
      if ("message" in result.body) {
        return NextResponse.json({ success: false, error: result.body.message }, { status: result.status });
      }
      return NextResponse.json({ success: true, task: result.body }, { status: result.status });
    } catch (error) {
      console.error("/api/mcp/tasks/waiting-on", error);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
  })(request);
}
