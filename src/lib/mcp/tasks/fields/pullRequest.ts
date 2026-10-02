import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskPullRequest(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { parsedPullRequest, linkPullRequest, user, ctx } = context;
    if (parsedPullRequest) {
        await linkPullRequest({
            taskId: task.id,
            userId: user.id,
            agentId: ctx.agentId,
            url: parsedPullRequest.url,
        });
    }
}
