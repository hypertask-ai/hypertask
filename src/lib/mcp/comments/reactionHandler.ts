import { NextRequest, NextResponse } from 'next/server';

export type CommentReactionTarget = {
  commentId: number;
  taskId: number;
  projectId: number;
  creatorId: number | null;
  text: string;
  taskUniqueIndex: number;
};

export type CommentReactionResult = {
  changed: boolean;
  reaction: { id: string; emoji: string; userId: number } | null;
  reactions: Array<{ id: string; emoji: string; userId: number }>;
};

export type CommentReactionDependencies<TContext> = {
  checkRateLimit: (request: NextRequest) => Promise<Response | null>;
  validateAuth: (request: NextRequest) => Promise<TContext | null>;
  authorizeWrite: (context: TContext) => Promise<Response | null>;
  featureEnabled: (context: TContext) => Promise<boolean>;
  actorUserId: (context: TContext) => number;
  findTarget: (context: TContext, commentId: number) => Promise<CommentReactionTarget | null>;
  setReaction: (
    target: CommentReactionTarget,
    userId: number,
    emoji: string,
    active: boolean
  ) => Promise<CommentReactionResult>;
  afterChange: (
    target: CommentReactionTarget,
    userId: number,
    emoji: string,
    active: boolean,
    result: CommentReactionResult
  ) => Promise<void>;
};

function validEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  const codePoints = Array.from(normalized);
  return normalized === value &&
    codePoints.length > 0 &&
    codePoints.length <= 8 &&
    !/[\p{Cc}\p{Cs}]/u.test(normalized) &&
    !/[A-Za-z0-9]/.test(normalized);
}

export function createCommentReactionHandler<TContext>(
  dependencies: CommentReactionDependencies<TContext>
) {
  return async function reactToComment(
    request: NextRequest,
    props: { params: Promise<{ comment_id: string }> }
  ) {
    const rateLimited = await dependencies.checkRateLimit(request);
    if (rateLimited) return rateLimited;

    const context = await dependencies.validateAuth(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      );
    }
    const scopeError = await dependencies.authorizeWrite(context);
    if (scopeError) return scopeError;

    let featureEnabled = false;
    try {
      featureEnabled = await dependencies.featureEnabled(context);
    } catch (error) {
      console.error('[comment-reaction] feature flag check failed', error);
    }
    if (!featureEnabled) {
      return NextResponse.json(
        { success: false, error: 'Not found.' },
        { status: 404 }
      );
    }

    const { comment_id: rawCommentId } = await props.params;
    const commentId = Number(rawCommentId);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      return NextResponse.json(
        { success: false, error: 'comment_id must be a positive integer.' },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Request body must be an object.' }, { status: 400 });
    }
    const { emoji, active } = body as { emoji?: unknown; active?: unknown };
    if (!validEmoji(emoji)) {
      return NextResponse.json(
        { success: false, error: 'emoji must be 1-8 non-alphanumeric Unicode characters.' },
        { status: 400 }
      );
    }
    if (typeof active !== 'boolean') {
      return NextResponse.json({ success: false, error: 'active must be a boolean.' }, { status: 400 });
    }

    const target = await dependencies.findTarget(context, commentId);
    if (!target) {
      return NextResponse.json(
        { success: false, error: 'Comment not found or access denied.' },
        { status: 404 }
      );
    }
    const userId = dependencies.actorUserId(context);
    const result = await dependencies.setReaction(target, userId, emoji, active);
    try {
      await dependencies.afterChange(target, userId, emoji, active, result);
    } catch (error) {
      // The reaction is already committed. A notification or realtime outage
      // must not turn a successful, idempotent mutation into a client retry.
      console.error('[comment-reaction] post-commit side effect failed', error);
    }
    return NextResponse.json({ success: true, active, ...result });
  };
}
