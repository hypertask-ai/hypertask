import { logMinutes, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { parseTimeMinutes } from "@/lib/timeManualEntry";
import { NextRequest, NextResponse } from "next/server";
import { resolveMcpTimeTask } from "@/lib/mcp/operations/time/helpers";

export async function POST(request: NextRequest) {
  const resolved = await resolveMcpTimeTask(request);
  if (resolved.response) return resolved.response;

  const minutes = parseTimeMinutes(resolved.body?.minutes);
  if (minutes === null) {
    return NextResponse.json(
      { success: false, error: "minutes must be an integer from 1 to 1440" },
      { status: 400 }
    );
  }

  if (resolved.body.date !== undefined && typeof resolved.body.date !== "string") {
    return NextResponse.json(
      { success: false, error: "date must be a YYYY-MM-DD string" },
      { status: 400 }
    );
  }

  try {
    const entry = await logMinutes(
      resolved.ctx.user.id,
      resolved.task.id,
      minutes,
      resolved.ctx.agentId,
      resolved.body.date,
      resolved.body.timezone_offset_minutes,
      resolved.body.note
    );
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    if (error instanceof TimeTrackingDisabledError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    throw error;
  }
}
