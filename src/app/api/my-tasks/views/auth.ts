import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "#with-auth";
import { isFeatureEnabled, MY_TASKS_VIEWS_FLAG } from "@/lib/flags";

export const authorizeMyTasksViewsRequest = async (request: NextRequest) => {
  const userId = (await getAuthSession(request.headers))?.userId;
  if (!userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!(await isFeatureEnabled(MY_TASKS_VIEWS_FLAG, userId))) {
    return {
      response: NextResponse.json(
        { error: "My Tasks views are not enabled" },
        { status: 403 },
      ),
    };
  }
  return { userId };
};
