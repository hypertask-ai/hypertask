import { boardPullRequestAuthorization } from '@/lib/pullRequests/boardPullRequestAccess';
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskPullRequest(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { parsedPullRequest, linkPullRequest, user, ctx } = context;
    if (parsedPullRequest) {
        const authorization = await boardPullRequestAuthorization(
            task.projectId,
            parsedPullRequest,
            user.id,
        );
        await linkPullRequest({
            taskId: task.id,
            userId: user.id,
            agentId: ctx.agentId, teamScope: ctx.teamScope,
            url: parsedPullRequest.url,
            ...(authorization ? { authorization } : {}),
        });
    }
}
