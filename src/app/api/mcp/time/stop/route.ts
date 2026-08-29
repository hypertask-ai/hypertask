import { stopTimer, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { resolveMcpTimeTask } from "../_lib";

export async function POST(request: NextRequest) {
  const resolved = await resolveMcpTimeTask(request, { allowArchived: true });
  if (resolved.response) return resolved.response;

  try {
    const entry = await stopTimer(
      resolved.ctx.user.id,
      resolved.task.id,
      resolved.ctx.agentId
    );
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
}
