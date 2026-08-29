import { logMinutes, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { parseTimeMinutes } from "@/lib/timeManualEntry";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId, validateTimeTaskAccess } from "../_lib";

export async function POST(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const taskId = parseTaskId(body?.taskId);
  const minutes = parseTimeMinutes(body?.minutes);
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId must be a positive integer" },
      { status: 400 }
    );
  }
  if (minutes === null) {
    return NextResponse.json(
      { success: false, error: "minutes must be an integer from 1 to 1440" },
      { status: 400 }
    );
  }

  const accessError = await validateTimeTaskAccess(auth.userId, taskId);
  if (accessError) return accessError;

  try {
    const entry = await logMinutes(auth.userId, taskId, minutes);
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
