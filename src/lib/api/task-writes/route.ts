import type { NextApiHandler, NextApiRequest } from "next";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/getSessionUser";

// Pages has already parsed JSON. This narrow Web-request interface avoids a
// second parse/serialization and also accepts a real App Router Request.
export type TaskWriteRequest = Pick<Request, "headers" | "json"> & {
  cookies?: Partial<Record<string, string>>;
  // Preserve Pages header arrays for acting-tab socket exclusion.
  rawHeaders?: NextApiRequest["headers"];
  query?: NextApiRequest["query"];
  url?: string;
};
// Pages view writes retain historical 101 errors, which Web Response rejects.
export type TaskWriteResponse = Pick<NextResponse, "status" | "headers" | "text" | "json">;
export type TaskWriteRoute = (
  request: TaskWriteRequest,
  session?: SessionUser,
) => Promise<TaskWriteResponse | undefined>;

export function taskWriteRoute<Body, Actor = SessionUser>(options: {
  schema: z.ZodType<Body>;
  validationMessage: string;
  validateBeforeAuth?: boolean;
  // Some legacy handlers catch null-body destructuring with nonstandard JSON.
  allowNullBody?: boolean;
  prepare?: (session: SessionUser) => Promise<Actor>;
  operation: (body: Body, actor: Actor, request: TaskWriteRequest) => Promise<TaskWriteResponse | undefined>;
}): TaskWriteRoute {
  return async (request, authenticatedSession) => {
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
      // Legacy destructuring of null/undefined throws before required-field checks.
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
    return options.operation(body, actor, request);
  };
}

type TaskWriteRouteLoader = () => Promise<TaskWriteRoute>;

// Pages stays the URL owner; each listed method always answers with its shared
// route ("*" answers every method). Other methods go to `fallback`, or get 405.
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
    // A failed lookup leaves auth to the route, which answers its own 401.
    const session = (await getSessionUser(headers).catch(() => null)) ?? undefined;
    const route = await loadRoute();
    const response = await route({ headers, rawHeaders: req.headers, cookies: req.cookies, query: req.query, json: async () => req.body }, session);
    // Creation historically leaves unresolved sections/ranks without a response.
    if (!response) return;
    response.headers.forEach((value, name) => {
      if (name !== "content-type") res.setHeader(name, value);
    });
    // Relation failures historically send an empty 200, not JSON null.
    const text = await response.text();
    // Download errors use Pages' text send contract, not a JSON string.
    if (text && !response.headers.get("content-type")?.includes("application/json")) {
      return res.status(response.status).send(text);
    }
    return res.status(response.status).json(text ? JSON.parse(text) : undefined);
  };
}
