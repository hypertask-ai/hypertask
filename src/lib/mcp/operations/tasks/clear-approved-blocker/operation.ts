import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7723_TASK_WAITING_ON_FLAG } from "@/lib/flags/definitions/htpr-7723-task-waiting-on";
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import {
  wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit,
  mcpRouteUnauthorizedResponse, withMcpRouteMutationLease,
} from "@/lib/mcp/routeWrapper";
import { approvedBlockerClearSchema, setTaskWaitingOn } from "@/lib/tasks/setWaitingOn";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";

const requestSchema = z.object({
  taskId: z.number().int().positive().max(2_147_483_647),
  approvedClear: approvedBlockerClearSchema,
}).strict();

export const POST = wrapMcpRoute(async (request: NextRequest) => {
  const limited = await checkMcpRouteRateLimit(request);
  if (limited) return limited;
  const ctx = await validateMcpRouteAuth(request);
  if (!ctx) return mcpRouteUnauthorizedResponse(request);
  const refused = await requireAgentWriteRole(ctx);
  if (refused) return refused;
  if (!(await isFeatureEnabled(HTPR_7723_TASK_WAITING_ON_FLAG, ctx.user.id))) {
    return NextResponse.json({ success: false, error: "Task waiting-on is not enabled" }, { status: 404 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Provide taskId and the expected marked question and approval" }, { status: 400 });
  const currentUser = await loadSessionUserRecord(ctx.user.id);
  const result = await withMcpRouteMutationLease(
    prisma, { agentId: ctx.agentId, userId: ctx.user.id },
    () => setTaskWaitingOn({
      ...parsed.data, userId: null, blockerCommentId: null,
      currentUser, agentId: ctx.agentId, teamScope: ctx.teamScope,
    }),
  );
  if ("message" in result.body) return NextResponse.json({ success: false, error: result.body.message }, { status: result.status });
  return NextResponse.json({ success: true, task: result.body }, { status: result.status });
});
