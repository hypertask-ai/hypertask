import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import {
  MY_TASKS_LIVE_UPDATES_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_SNOOZE_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
import {
  effectiveMyTasksScopes,
  normalizeMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import getMyTasks from "@/utils/controllers/tasks/myTasks";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseScopesParam = (raw: string | null): MyTasksScope[] => {
  if (!raw) return normalizeMyTasksScopes(undefined);
  return normalizeMyTasksScopes(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
};

export async function GET(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [scopesEnabled, viewsEnabled, snoozeEnabled] = await Promise.all([
      isFeatureEnabled(MY_TASKS_SCOPES_FLAG, userId),
      isFeatureEnabled(MY_TASKS_VIEWS_FLAG, userId),
      isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId),
    ]);
    const requested = parseScopesParam(request.nextUrl.searchParams.get("scopes"));
    const scopes = effectiveMyTasksScopes(requested, scopesEnabled);
    const showSnoozed =
      snoozeEnabled &&
      request.nextUrl.searchParams.get("showSnoozed") === "1";

    const myTasks = await getMyTasks(userId, viewsEnabled, scopes, {
      throwOnError: true,
      snoozeEnabled,
      showSnoozed,
    });
    const liveUpdatesEnabled = await isFeatureEnabled(MY_TASKS_LIVE_UPDATES_FLAG, userId);
    let accessibleProjectIds: number[] = [];
    if (liveUpdatesEnabled) {
      const { json: projects } = await getAllMinimal(userId, "Calendar", false);
      accessibleProjectIds = projects.map((project) => project.id);
    }
    Object.assign(myTasks, { accessibleProjectIds });
    return NextResponse.json(myTasks, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[my-tasks] list failed", error);
    return NextResponse.json({ error: "Unable to load My Tasks" }, { status: 500 });
  }
}
