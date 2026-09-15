import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled, MY_TASKS_SNOOZE_FLAG } from "@/lib/flags";
import { setMyTasksSnooze } from "@/utils/controllers/tasks/myTasksSnooze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId))) {
      return NextResponse.json(
        { error: "My Tasks snooze is not enabled" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      assignmentId?: unknown;
      taskId?: unknown;
      snoozeUntil?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const assignmentId =
      body.assignmentId === undefined || body.assignmentId === null
        ? undefined
        : typeof body.assignmentId === "number"
          ? body.assignmentId
          : Number(body.assignmentId);
    const taskId =
      body.taskId === undefined || body.taskId === null
        ? undefined
        : typeof body.taskId === "number"
          ? body.taskId
          : Number(body.taskId);
    const result = await setMyTasksSnooze({
      userId,
      assignmentId: Number.isFinite(assignmentId) ? assignmentId : undefined,
      taskId: Number.isFinite(taskId) ? taskId : undefined,
      snoozeUntil: body.snoozeUntil,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[my-tasks/snooze] failed", error);
    return NextResponse.json({ error: "Unable to snooze task" }, { status: 500 });
  }
}
