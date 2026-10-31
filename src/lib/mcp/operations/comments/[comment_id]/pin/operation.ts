import { createCommentSaveHandler } from '@/lib/mcp/comments/commentSaveHandler';
import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard';
import { wrapMcpRoute, validateMcpRouteAuth, checkMcpRouteRateLimit } from '@/lib/mcp/routeWrapper';
import prisma from '@/lib/prisma';
import { projectContentAccessWhere } from '@/utils/controllers/projects/getAllIncludes';
import { toggleSavedContent } from '@/utils/controllers/savedContent/toggleSavedContent';

export function commentSaveOperation(mode: 'pin' | 'star') {
  return wrapMcpRoute(createCommentSaveHandler({
    mode,
    checkRateLimit: checkMcpRouteRateLimit,
    validateAuth: validateMcpRouteAuth,
    authorizeWrite: (ctx) => requireAgentWriteRole(ctx),
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
      const result = await toggleSavedContent({ ...target, userId: ctx.user.id, agentId: ctx.agentId ?? null, type: selectedMode === 'pin' ? 'Public' : 'Private' });
      return result.status === 200;
    },
  }));
}

export const POST = commentSaveOperation('pin');
