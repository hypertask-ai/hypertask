import { toErrorMessage } from "@/lib/api/errorMessage";
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
            if (archiveResponse.status >= 400 && archiveResponse.status < 500 && typeof errorData?.code === 'string') {
                throw Object.assign(error, { status: archiveResponse.status, code: errorData.code })
            }
            throw error
        }
        await archiveResponse.json().catch(() => null)
    }
}
