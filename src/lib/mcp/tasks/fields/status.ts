import { toErrorMessage } from "@/lib/api/errorMessage";
import { forwardedRefusal } from '@/lib/api/refusal';
import { AgentDoneLifecycleDeniedError } from '@/lib/mcp/tasks/agentDoneLifecycle';
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskStatus(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { requestBody, baseUrl, ctx, authCookieHeader } = context;
    const fetchOpts = {
        headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookieHeader
        }
    }
    if (requestBody.status) {
        const archiveUrl = `${baseUrl}/api/tasks/(un)archive`
        const archiveResponse = await fetch(archiveUrl, {
            method: 'POST',
            redirect: 'manual',
            ...fetchOpts,
            body: JSON.stringify({
                taskId: task.id,
                status: requestBody.status,
                agentId: ctx.agentId || undefined
            })
        })
        if (!archiveResponse.ok) {
            const errorData = await archiveResponse.json().catch(() => null)
            const error = new Error(
                toErrorMessage(
                    errorData,
                    `Archive/status update failed: ${archiveResponse.status}`
                )
            )
            if (archiveResponse.status === 403 && errorData?.code === 'agent_done_lifecycle_denied') {
                throw new AgentDoneLifecycleDeniedError(error.message)
            }
            if (typeof errorData?.code === 'string') {
                const refusal = forwardedRefusal(
                    archiveResponse.status,
                    errorData.code,
                    error.message,
                    typeof errorData.field === 'string' ? errorData.field : undefined,
                )
                if (refusal) throw refusal
            }
            throw error
        }
        await archiveResponse.json().catch(() => null)
    }
}
