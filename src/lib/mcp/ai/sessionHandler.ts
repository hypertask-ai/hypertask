import { NextRequest, NextResponse } from 'next/server';

export type AiSessionPayload = Record<string, unknown>;

export type AiSessionHandlerDependencies<TContext> = {
  checkRateLimit: (request: NextRequest) => Promise<Response | null>;
  validateAuth: (request: NextRequest) => Promise<TContext | null>;
  authorizeRead: (context: TContext) => Promise<Response | null>;
  authorizeWrite: (context: TContext) => Promise<Response | null>;
  actorUserId: (context: TContext) => number;
  actorAgentId: (context: TContext) => string | null;
  validateProject: (
    userId: number,
    agentId: string | null,
    projectId: number
  ) => Promise<Response | null>;
  list: (context: TContext, limit: number, offset: number) => Promise<{
    sessions: AiSessionPayload[];
    total: number;
  }>;
  messages: (context: TContext, id: string, limit: number, offset: number) => Promise<{
    session: AiSessionPayload;
    total: number;
  } | null>;
  create: (input: {
    context: TContext;
    userId: number;
    agentId: string | null;
    id: string;
    projectId: number | null;
    title: string;
  }) => Promise<AiSessionPayload | null>;
  rename: (context: TContext, id: string, title: string) => Promise<AiSessionPayload | null>;
  remove: (context: TContext, id: string) => Promise<void>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthorized() {
  return NextResponse.json(
    { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
    { status: 401 }
  );
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) return null;
  return parsed;
}

async function contextFor<TContext>(
  request: NextRequest,
  dependencies: AiSessionHandlerDependencies<TContext>,
  operation: 'read' | 'write'
): Promise<{ context: TContext } | { response: Response }> {
  const rateLimited = await dependencies.checkRateLimit(request);
  if (rateLimited) return { response: rateLimited };
  const context = await dependencies.validateAuth(request);
  if (!context) return { response: unauthorized() };
  const scopeError = operation === 'read'
    ? await dependencies.authorizeRead(context)
    : await dependencies.authorizeWrite(context);
  return scopeError ? { response: scopeError } : { context };
}

export function createAiSessionsCollectionHandlers<TContext>(
  dependencies: AiSessionHandlerDependencies<TContext>
) {
  return {
    GET: async (request: NextRequest) => {
      const resolved = await contextFor(request, dependencies, 'read');
      if ('response' in resolved) return resolved.response;
      const limit = positiveInteger(request.nextUrl.searchParams.get('limit'), 50, 100);
      const offset = positiveInteger(request.nextUrl.searchParams.get('offset'), 0, 10_000);
      if (limit === null || limit === 0 || offset === null) {
        return NextResponse.json(
          { success: false, error: 'limit must be 1-100 and offset must be 0-10000.' },
          { status: 400 }
        );
      }
      const sessionId = request.nextUrl.searchParams.get('session_id')?.trim() || null;
      if (sessionId !== null) {
        if (!UUID_PATTERN.test(sessionId)) {
          return NextResponse.json({ success: false, error: 'session_id must be a UUID.' }, { status: 400 });
        }
        const result = await dependencies.messages(resolved.context, sessionId, limit, offset);
        if (!result) return NextResponse.json({ success: false, error: 'Session not found.' }, { status: 404 });
        return NextResponse.json({
          success: true,
          session: result.session,
          message_total: result.total,
          message_limit: limit,
          message_offset: offset,
        });
      }
      const result = await dependencies.list(resolved.context, limit, offset);
      return NextResponse.json({ success: true, ...result, limit, offset });
    },

    POST: async (request: NextRequest) => {
      const resolved = await contextFor(request, dependencies, 'write');
      if ('response' in resolved) return resolved.response;
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = await request.json();
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return NextResponse.json({ success: false, error: 'Request body must be a JSON object.' }, { status: 400 });
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
      }
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const title = typeof body.title === 'string' ? body.title.trim() : 'New AI Chat';
      const projectId = body.project_id === undefined || body.project_id === null
        ? null
        : Number(body.project_id);
      if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ success: false, error: 'id must be a UUID.' }, { status: 400 });
      }
      if (!title || title.length > 120) {
        return NextResponse.json({ success: false, error: 'title must be 1-120 characters.' }, { status: 400 });
      }
      if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0)) {
        return NextResponse.json({ success: false, error: 'project_id must be a positive integer.' }, { status: 400 });
      }
      const userId = dependencies.actorUserId(resolved.context);
      const agentId = dependencies.actorAgentId(resolved.context);
      if (projectId !== null) {
        const projectError = await dependencies.validateProject(
          userId,
          agentId,
          projectId
        );
        if (projectError) return projectError;
      }
      const session = await dependencies.create({ context: resolved.context, userId, agentId, id, projectId, title });
      if (!session) {
        return NextResponse.json(
          { success: false, error: 'Session ID is already owned by another account.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, session });
    },
  };
}

export function createAiSessionItemHandlers<TContext>(
  dependencies: AiSessionHandlerDependencies<TContext>
) {
  async function resolveId(props: { params: Promise<{ sessionId: string }> }) {
    const id = (await props.params).sessionId;
    return UUID_PATTERN.test(id) ? id : null;
  }

  return {
    PATCH: async (
      request: NextRequest,
      props: { params: Promise<{ sessionId: string }> }
    ) => {
      const resolved = await contextFor(request, dependencies, 'write');
      if ('response' in resolved) return resolved.response;
      const id = await resolveId(props);
      if (!id) return NextResponse.json({ success: false, error: 'sessionId must be a UUID.' }, { status: 400 });
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = await request.json();
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return NextResponse.json({ success: false, error: 'Request body must be a JSON object.' }, { status: 400 });
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
      }
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 120) {
        return NextResponse.json({ success: false, error: 'title must be 1-120 characters.' }, { status: 400 });
      }
      const session = await dependencies.rename(resolved.context, id, title);
      if (!session) {
        return NextResponse.json({ success: false, error: 'Session not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, session });
    },

    DELETE: async (
      request: NextRequest,
      props: { params: Promise<{ sessionId: string }> }
    ) => {
      const resolved = await contextFor(request, dependencies, 'write');
      if ('response' in resolved) return resolved.response;
      const id = await resolveId(props);
      if (!id) return NextResponse.json({ success: false, error: 'sessionId must be a UUID.' }, { status: 400 });
      await dependencies.remove(resolved.context, id);
      return NextResponse.json({ success: true, deleted: true, id });
    },
  };
}
