import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { MY_TASKS_SNOOZE_FLAG } from "@/lib/flags/keys";
import { parseIanaTimeZone } from "@/lib/myTasksTimeZone";
import { getMyTasksOverdueCounts } from "@/utils/controllers/tasks/myTasksOverdueCounts";
import { getMyTasksViews } from "@/utils/controllers/tasks/myTasksViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const timeZone = parseIanaTimeZone(
      request.nextUrl.searchParams.get("timeZone"),
    );
    if (!timeZone) {
      return NextResponse.json(
        { error: "A valid timeZone is required" },
        { status: 400 },
      );
    }

    const snoozeEnabled = await isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId);
    const views = await getMyTasksViews(userId);
    const counts = await getMyTasksOverdueCounts({
      userId,
      views,
      snoozeEnabled,
      applyFilterSettings: true,
      timeZone,
    });
    return NextResponse.json(counts, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[my-tasks/overdue-counts] failed", error);
    return NextResponse.json(
      { error: "Unable to load overdue counts" },
      { status: 500 },
    );
  }
}
