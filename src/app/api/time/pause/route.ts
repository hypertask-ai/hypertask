import { pauseTimer, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId, validateTimeTaskAccess } from "../_lib";

export async function POST(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const taskId = parseTaskId(body?.taskId);
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId must be a positive integer" },
      { status: 400 }
    );
  }

  const accessError = await validateTimeTaskAccess(auth.userId, taskId);
  if (accessError) return accessError;

  try {
    const entry = await pauseTimer(auth.userId, taskId);
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
