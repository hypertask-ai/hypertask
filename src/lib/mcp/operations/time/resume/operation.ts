import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { resumeTimer, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { resolveMcpTimeTask } from "@/lib/mcp/operations/time/helpers";

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const resolved = await resolveMcpTimeTask(request);
  if (resolved.response) return resolved.response;
  const roleRefusal = await requireAgentWriteRole(resolved.ctx);
  if (roleRefusal) return roleRefusal;

  try {
    const entry = await resumeTimer(
      resolved.ctx.user.id,
      resolved.task.id,
      resolved.ctx.agentId, resolved.ctx.teamScope
    );
    if (!entry) {
      return NextResponse.json(
        { success: false, error: "There is no paused timer on that task." },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    if (error instanceof TimeTrackingDisabledError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    throw error;
  }

  })(request)
}
