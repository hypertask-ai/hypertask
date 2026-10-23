import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import type { NextApiHandler, NextApiRequest } from "next";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/getSessionUser";
import { parseCookies } from "better-auth/cookies";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export type TaskWriteRequest = Pick<Request, "headers" | "json"> & {
  cookies?: Partial<Record<string, string>>;
  rawHeaders?: NextApiRequest["headers"];
  query?: NextApiRequest["query"];
  url?: string;
  method?: string;
};
export type TaskWriteResponse = Pick<NextResponse, "status" | "headers" | "text" | "json">;
export type TaskWriteRoute = (
  request: TaskWriteRequest,
  session?: SessionUser,
) => Promise<TaskWriteResponse | undefined>;

export function taskWriteRoute<Body, Actor = SessionUser>(options: {
  schema: z.ZodType<Body>;
  validationMessage: string;
  validateBeforeAuth?: boolean;
  allowNullBody?: boolean;
  prepare?: (session: SessionUser) => Promise<Actor>;
  operation: (body: Body, actor: Actor, request: TaskWriteRequest) => Promise<TaskWriteResponse | undefined>;
}): TaskWriteRoute {
  return (request, authenticatedSession) => withAgentScopeRequest(request, async () => {
    if (authenticatedSession) await prepareAgentScope(authenticatedSession.userId, authenticatedSession.agentId);
    let session = authenticatedSession;
    let actor!: Actor;
    if (!options.validateBeforeAuth) {
      session ??= (await getSessionUser(request.headers)) ?? undefined;
      if (!session) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
      actor = options.prepare ? await options.prepare(session) : session as Actor;
    }
    let body: Body;
    try {
      const raw = await request.json();
      if (raw == null && !options.allowNullBody) throw new Error("Missing body");
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { message: options.validationMessage },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
    if (options.validateBeforeAuth) {
      try {
        session ??= (await getSessionUser(request.headers)) ?? undefined;
        if (!session) {
          return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }
        actor = options.prepare ? await options.prepare(session) : session as Actor;
      } catch {
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
      }
    }
    const bodyAgentId = (body as { agentId?: unknown } | null)?.agentId;
    if (session?.agentId) {
      if (bodyAgentId !== session.agentId) {
        return NextResponse.json({ message: "Agent id must match authenticated session" }, { status: 403 });
      }
    }
    if (session && typeof bodyAgentId === "string") await prepareAgentScope(session.userId, bodyAgentId);
    return options.operation(body, actor, request);
  });
}

export async function legacyTaskWriteSession(request: TaskWriteRequest, allowSessionFallback = false): Promise<SessionUser | null> {
  const token = request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE);
  const signed = verifySession(token);
  if (!signed) return allowSessionFallback ? getSessionUser(request.headers) : null;
  if (signed.agentId) {
    return getSessionUser(new Headers({ Cookie: `${SESSION_COOKIE}=${token}` }));
  }
  return { userId: signed.id, teamScope: null, source: "legacy", needsBridge: true };
}

type TaskWriteRouteLoader = () => Promise<TaskWriteRoute>;

export function taskWriteHandler(
  routes: Partial<Record<string, TaskWriteRouteLoader>>,
  options: { fallback?: NextApiHandler; methodNotAllowed?: unknown } = {},
): NextApiHandler {
  return async (req, res) => {
    const loadRoute = routes[req.method ?? ""] ?? routes["*"];
    if (!loadRoute) {
      if (options.fallback) return options.fallback(req, res);
      return res.status(405).json(options.methodNotAllowed ?? { message: "Method not allowed" });
    }
    const headers = new Headers(req.headers as Record<string, string>);
    const session = (await getSessionUser(headers).catch(() => null)) ?? undefined;
    const route = await loadRoute();
    const response = await route({ headers, url: req.url, method: req.method, rawHeaders: req.headers, cookies: req.cookies, query: req.query, json: async () => req.body }, session);
    if (!response) return;
    response.headers.forEach((value, name) => {
      if (name !== "content-type") res.setHeader(name, value);
    });
    const text = await response.text();
    if (text && !response.headers.get("content-type")?.includes("application/json")) {
      return res.status(response.status).send(text);
    }
    return res.status(response.status).json(text ? JSON.parse(text) : undefined);
  };
}
