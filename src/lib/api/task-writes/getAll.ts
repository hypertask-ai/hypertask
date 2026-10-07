import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import tasksGetAll from "@/utils/controllers/tasks/getAll";

const route = taskWriteRoute({
  schema: z.custom<{ projectId?: number | string | string[] }>(() => true),
  validationMessage: "Missing Required Data",
  allowNullBody: true,
  operation: async (body, session, request) => {
    try {
      const { projectId } = body;
      if (!projectId) {
        return NextResponse.json("Missing Required Data", { status: 200 });
      }
      let compact = false;
      if (taskReadQuery(request).compat === "htpr-6924") {
        try {
          compact = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, session.userId);
        } catch {
          // A failed flag probe must preserve the legacy response.
        }
      }
      const response = compact
        ? await tasksGetAll(projectId, session.userId, "compact")
        : await tasksGetAll(projectId, session.userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json([], { status: 200 });
    }
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return await route({ ...request, headers: request.headers, url: request.url, json: async () => body }, session);
  } catch (error) {
    console.log(error);
    return NextResponse.json([], { status: 200 });
  }
};
