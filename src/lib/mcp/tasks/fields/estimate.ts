import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskEstimate(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { estimateConstant, baseUrl, authCookieHeader, ctx, strictSideEffectFailures } = context;
    if (estimateConstant) {
        const estimateApiUrl = `${baseUrl}/api/estimate/setEstimate`
        const estimateResponse = await fetch(estimateApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': authCookieHeader
            },
            body: JSON.stringify({
                taskId: task.id,
                estimate_index: estimateConstant.estimate_index,
                estimate_value: estimateConstant.estimate_value,
                agentId: ctx.agentId || undefined
            })
        })
        
        if (!estimateResponse.ok) {
            console.warn(`[MCP Update Task] Failed to update estimate for task ${task.id}`)
            if (strictSideEffectFailures) {
                throw new Error(
                    `Estimate update failed: ${estimateResponse.status}`
                )
            }
        }
    }
}
