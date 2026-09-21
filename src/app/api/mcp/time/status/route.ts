import { withoutAuth } from "#with-auth";
import { taskSummary, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { resolveMcpTimeTask } from "../_lib";

async function POSTHandler(request: NextRequest) {
  const resolved = await resolveMcpTimeTask(request);
  if (resolved.response) return resolved.response;

  try {
    const summary = await taskSummary(resolved.ctx.user.id, resolved.task.id);
    return NextResponse.json({ success: true, summary });
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

export const POST = withoutAuth(POSTHandler);
