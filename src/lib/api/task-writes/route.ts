import type { NextApiHandler } from "next";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6923_APP_ROUTER_WRITES_FLAG } from "@/lib/flags/keys";

// Pages has already parsed JSON. This narrow Web-request interface avoids a
// second parse/serialization and also accepts a real App Router Request.
export type TaskWriteRequest = Pick<Request, "headers" | "json"> & {
  cookies?: Partial<Record<string, string>>;
};
export type TaskWriteRoute = (
  request: TaskWriteRequest,
  session?: SessionUser,
) => Promise<NextResponse | undefined>;

export function taskWriteRoute<Body, Actor = SessionUser>(options: {
  schema: z.ZodType<Body>;
  validationMessage: string;
  validateBeforeAuth?: boolean;
  prepare?: (session: SessionUser) => Promise<Actor>;
  operation: (body: Body, actor: Actor, request: TaskWriteRequest) => Promise<NextResponse | undefined>;
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
      if (raw == null) throw new Error("Missing body");
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

export function withTaskWriteFlag(
  legacy: NextApiHandler,
  method: string,
  loadRoute: () => Promise<TaskWriteRoute>,
): NextApiHandler {
  return async (req, res) => {
    if (req.method !== method) return legacy(req, res);
    let session: SessionUser | null = null;
    let enabled = false;
    let headers: Headers | undefined;
    try {
      headers = new Headers(req.headers as Record<string, string>);
      session = await getSessionUser(headers);
      enabled = !!session && await isFeatureEnabled(
        HTPR_6923_APP_ROUTER_WRITES_FLAG,
        session.userId,
      );
    } catch {
      // A flag/auth lookup outage must not enable the new write path.
    }
    if (!enabled || !session || !headers) return legacy(req, res);
    const route = await loadRoute();
    // Never retry legacy after dispatch: the operation may already have written.
    const response = await route({ headers, cookies: req.cookies, json: async () => req.body }, session);
    // Creation historically leaves unresolved sections/ranks without a response.
    if (!response) return;
    response.headers.forEach((value, name) => {
      if (name !== "content-type") res.setHeader(name, value);
    });
    return res.status(response.status).json(await response.json());
  };
}
