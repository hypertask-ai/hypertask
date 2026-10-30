import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG } from "@/lib/flags/definitions/htpr-8217-agent-follow-reminder";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import {
  wrapMcpRoute,
  validateMcpRouteAuth,
  checkMcpRouteRateLimit,
  mcpRouteUnauthorizedResponse,
  withMcpRouteMutationLease,
} from "@/lib/mcp/routeWrapper";
import { findIdParamOutOfRange, idOutOfRangeMessage } from "@/lib/mcp/listParams";
import { setTaskTracking, type TaskTrackingAction } from "@/lib/tasks/taskTracking";
import prisma from "@/lib/prisma";

const ACTIONS = ["follow", "unfollow", "star", "unstar", "remind", "read"] as const;

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) return await mcpRouteUnauthorizedResponse(request);
      let body;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ success: false, error: "Invalid request body", message: "Request body must be valid JSON" }, { status: 400 });
      }
      const action = body?.action;
      if (action !== "read") {
        const roleRefusal = await requireAgentWriteRole(ctx);
        if (roleRefusal) return roleRefusal;
      }
      if (ctx.agentId && !(await isFeatureEnabled(HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG, ctx.user.id))) {
        return NextResponse.json({ success: false, error: "Agent task tracking is not enabled" }, { status: 404 });
      }
      if (
        !body ||
        Array.isArray(body) ||
        !ACTIONS.includes(action) ||
        typeof body.taskId !== "number" ||
        !Number.isInteger(body.taskId) ||
        body.taskId <= 0 ||
        (body.remindAt !== undefined && body.remindAt !== null && typeof body.remindAt !== "string")
      ) {
        return NextResponse.json({ success: false, error: `Provide action (${ACTIONS.join(", ")}) and integer taskId` }, { status: 400 });
      }
      if (action === "remind" && (typeof body.remindAt !== "string" || body.remindAt === "")) {
        return NextResponse.json({ success: false, error: "remind requires remindAt (ISO 8601 date time)" }, { status: 400 });
      }
      const outOfRange = findIdParamOutOfRange({ taskId: body.taskId });
      if (outOfRange) {
        return NextResponse.json({ success: false, error: idOutOfRangeMessage(outOfRange), code: "invalid_field" }, { status: 400 });
      }

      const tracked = () => setTaskTracking({
        action: action as TaskTrackingAction,
        taskId: body.taskId,
        remindAt: body.remindAt,
        currentUser: { id: ctx.user.id },
        agentId: ctx.agentId,
        teamScope: ctx.teamScope,
      });
      const result = action === "read"
        ? await tracked()
        : await withMcpRouteMutationLease(
            prisma,
            { agentId: ctx.agentId, userId: ctx.user.id },
            tracked,
          );
      if ("message" in result.body) {
        return NextResponse.json({ success: false, error: result.body.message }, { status: result.status });
      }
      return NextResponse.json({ success: true, ...result.body }, { status: result.status });
    } catch (error) {
      console.error("/api/mcp/tasks/follow", error);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
  })(request);
}
