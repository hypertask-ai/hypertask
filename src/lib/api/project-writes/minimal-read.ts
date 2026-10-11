import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import { parseCookies } from "better-auth/cookies";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const mode = req.body.mode as "ExtraMinimal" | "Calendar" | undefined;
    const response = await getAllMinimal(session.userId, mode);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const GET: TaskWriteRoute = async (request) => {
  // Preserve signed-cookie-only authorization, even after Better Auth preflight.
  const session = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route({ headers: request.headers, json: async () => taskReadQuery(request) }, { userId: session.id, source: "legacy", needsBridge: true });
};
