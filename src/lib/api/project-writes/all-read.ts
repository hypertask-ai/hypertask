import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getAllProjectsController from "@/utils/controllers/projects/getAll";
import { parseCookies } from "better-auth/cookies";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    // HTPR-7233: no console timer here. Timer labels are process-wide, so
    // overlapping requests would end each other's timer and Node would warn.
    const response = await getAllProjectsController(session.userId, session.userId, req.body?.projectId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const POST: TaskWriteRoute = async (request) => {
  // Preserve signed-cookie-only authorization, even after Better Auth preflight.
  const session = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, { userId: session.id, source: "legacy", needsBridge: true });
};
