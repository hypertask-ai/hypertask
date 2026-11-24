import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskPullRequest(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { parsedPullRequest, clearPullRequest, linkPullRequest, unlinkPullRequest, user, ctx } = context;
    if (clearPullRequest) {
        await unlinkPullRequest({
            taskId: task.id,
            userId: user.id,
            agentId: ctx.agentId, teamScope: ctx.teamScope,
        });
        return;
    }
    if (parsedPullRequest) {
        await linkPullRequest({
            taskId: task.id,
            userId: user.id,
            agentId: ctx.agentId, teamScope: ctx.teamScope,
            url: parsedPullRequest.url,
        });
    }
}
