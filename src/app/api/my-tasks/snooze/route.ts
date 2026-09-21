import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled, MY_TASKS_SNOOZE_FLAG } from "@/lib/flags";
import { setMyTasksSnooze } from "@/utils/controllers/tasks/myTasksSnooze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function POSTHandler(request: NextRequest) {
  try {
    const userId = (await getAuthSession(request.headers))?.userId;
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

    const result = await setMyTasksSnooze({
      userId,
      assignmentId: optionalFiniteNumber(body.assignmentId),
      taskId: optionalFiniteNumber(body.taskId),
      snoozeUntil: body.snoozeUntil,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    htLogger.error("[my-tasks/snooze] failed", error);
    return NextResponse.json({ error: "Unable to snooze task" }, { status: 500 });
  }
}

export const POST = withAuth(POSTHandler);
