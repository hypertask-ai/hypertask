import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import {
  MY_TASKS_FILTER_PARITY_FLAG,
  MY_TASKS_OVERDUE_BADGES_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_SNOOZE_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
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
    if (!(await isFeatureEnabled(MY_TASKS_OVERDUE_BADGES_FLAG, userId))) {
      return NextResponse.json(
        { error: "My Tasks overdue badges are not enabled" },
        { status: 403 },
      );
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

    const [viewsEnabled, scopesEnabled, snoozeEnabled, filterParityEnabled] =
      await Promise.all([
        isFeatureEnabled(MY_TASKS_VIEWS_FLAG, userId),
        isFeatureEnabled(MY_TASKS_SCOPES_FLAG, userId),
        isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId),
        isFeatureEnabled(MY_TASKS_FILTER_PARITY_FLAG, userId),
      ]);
    const views = viewsEnabled ? await getMyTasksViews(userId) : [];
    const counts = await getMyTasksOverdueCounts({
      userId,
      views,
      scopesEnabled,
      snoozeEnabled,
      applyFilterSettings: filterParityEnabled,
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
