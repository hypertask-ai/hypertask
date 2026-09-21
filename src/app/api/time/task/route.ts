import { taskSummary } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId, validateTimeTaskAccess } from "../_lib";

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const taskId = parseTaskId(request.nextUrl.searchParams.get("taskId"));
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId must be a positive integer" },
      { status: 400 }
    );
  }

  const accessError = await validateTimeTaskAccess(auth.userId, taskId);
  if (accessError) return accessError;

  const summary = await taskSummary(auth.userId, taskId);
  return NextResponse.json({ success: true, ...summary });
}
