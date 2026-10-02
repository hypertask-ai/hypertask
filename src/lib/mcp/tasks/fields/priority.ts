import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskPriority(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { priorityConstant, baseUrl, authCookieHeader, ctx, strictSideEffectFailures } = context;
    // Handle priority/estimate updates using their dedicated APIs
    if (priorityConstant) {
        const priorityApiUrl = `${baseUrl}/api/priority/setPriority`
        const priorityResponse = await fetch(priorityApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': authCookieHeader
            },
            body: JSON.stringify({
                taskId: task.id,
                priority_index: priorityConstant.priority_index,
                Priority_Value: priorityConstant.Priority_Value,
                agentId: ctx.agentId || undefined
            })
        })
        
        if (!priorityResponse.ok) {
            console.warn(`[MCP Update Task] Failed to update priority for task ${task.id}`)
            if (strictSideEffectFailures) {
                throw new Error(
                    `Priority update failed: ${priorityResponse.status}`
                )
            }
        }
    }
}
