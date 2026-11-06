import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const authorizeMyTasksViewsRequest = async (request: NextRequest) => {
  const userId = (await getSessionUser(request.headers))?.userId;
  if (!userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId };
};
