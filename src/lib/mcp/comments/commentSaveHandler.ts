import { findIdParamOutOfRange, idOutOfRangeMessage } from '@/lib/mcp/listParams';
import { NextRequest, NextResponse } from 'next/server';

type Target = { commentId: number; taskId: number; projectId: number };
type Dependencies<TContext> = {
  mode: 'pin' | 'star';
  checkRateLimit: (request: NextRequest) => Promise<Response | null>;
  validateAuth: (request: NextRequest) => Promise<TContext | null>;
  authorizeWrite: (context: TContext) => Promise<Response | null>;
  enabled: (context: TContext) => Promise<boolean>;
  findTarget: (context: TContext, commentId: number) => Promise<Target | null>;
  toggle: (context: TContext, target: Target, mode: 'pin' | 'star') => Promise<boolean>;
};

export function createCommentSaveHandler<TContext>(dependencies: Dependencies<TContext>) {
  return async function saveComment(request: NextRequest, props: { params: Promise<{ comment_id: string }> }) {
    const rateLimited = await dependencies.checkRateLimit(request);
    if (rateLimited) return rateLimited;
    const context = await dependencies.validateAuth(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized. Invalid or missing authentication token.' }, { status: 401 });
    const refusal = await dependencies.authorizeWrite(context);
    if (refusal) return refusal;
    if (!await dependencies.enabled(context)) {
      return NextResponse.json({ success: false, error: 'Comment pin and star are not enabled' }, { status: 404 });
    }
    const { comment_id } = await props.params;
    const commentId = Number(comment_id);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      return NextResponse.json({ success: false, error: 'comment_id must be a positive integer.' }, { status: 400 });
    }
    const outOfRange = findIdParamOutOfRange({ comment_id: commentId });
    if (outOfRange) return NextResponse.json({ success: false, error: idOutOfRangeMessage(outOfRange), code: 'invalid_field' }, { status: 400 });
    const target = await dependencies.findTarget(context, commentId);
    if (!target) return NextResponse.json({ success: false, error: 'Comment not found or access denied.' }, { status: 404 });
    const active = await dependencies.toggle(context, target, dependencies.mode);
    const state = dependencies.mode === 'pin' ? (active ? 'pinned' : 'unpinned') : (active ? 'starred' : 'unstarred');
    return NextResponse.json({ success: true, state });
  };
}
