import { createCommentSaveHandler } from '@/lib/mcp/comments/commentSaveHandler';
import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard';
import { wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit } from '@/lib/mcp/routeWrapper';
import { isFeatureEnabled } from '@/lib/flags';
import { HTPR_8218_COMMENT_PIN_STAR_FLAG } from '@/lib/flags/definitions/htpr-8218-comment-pin-star';
import prisma from '@/lib/prisma';
import { projectContentAccessWhere } from '@/utils/controllers/projects/getAllIncludes';
import { toggleSavedContent } from '@/utils/controllers/savedContent/toggleSavedContent';

export function commentSaveOperation(mode: 'pin' | 'star') {
  return wrapMcpRoute(createCommentSaveHandler({
    mode,
    checkRateLimit: checkMcpRouteRateLimit,
    validateAuth: validateMcpRouteAuth,
    authorizeWrite: (ctx) => requireAgentWriteRole(ctx),
    enabled: (ctx) => isFeatureEnabled(HTPR_8218_COMMENT_PIN_STAR_FLAG, ctx.user.id),
    findTarget: async (ctx, commentId) => {
      const comment = await prisma.comment.findFirst({
        where: {
          id: commentId,
          task: { project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope), AND: [{ project: projectContentAccessWhere(ctx.user.id) }] },
        },
        select: { id: true, taskId: true, task: { select: { projectId: true } } },
      });
      return comment ? { commentId: comment.id, taskId: comment.taskId, projectId: comment.task.projectId } : null;
    },
    toggle: async (ctx, target, selectedMode) => {
      const result = await toggleSavedContent({ ...target, userId: ctx.user.id, type: selectedMode === 'pin' ? 'Public' : 'Private' });
      return result.status === 200;
    },
  }));
}

export const POST = commentSaveOperation('pin');
