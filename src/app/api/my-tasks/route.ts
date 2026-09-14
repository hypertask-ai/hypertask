import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import {
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_VIEWS_FLAG,
} from "@/lib/flags/keys";
import {
  effectiveMyTasksScopes,
  normalizeMyTasksScopes,
  type MyTasksScope,
} from "@/lib/myTasksScopes";
import getMyTasks from "@/utils/controllers/tasks/myTasks";

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

    const [scopesEnabled, viewsEnabled] = await Promise.all([
      isFeatureEnabled(MY_TASKS_SCOPES_FLAG, userId),
      isFeatureEnabled(MY_TASKS_VIEWS_FLAG, userId),
    ]);
    const requested = parseScopesParam(request.nextUrl.searchParams.get("scopes"));
    const scopes = effectiveMyTasksScopes(requested, scopesEnabled);

    const myTasks = await getMyTasks(userId, viewsEnabled, scopes);
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
