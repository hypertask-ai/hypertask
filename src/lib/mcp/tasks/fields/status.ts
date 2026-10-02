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
    // 2. Status change: use (un)archive for activity + notifications
    if (requestBody.status) {
        const archiveUrl = `${baseUrl}/api/tasks/(un)archive`
        const archiveResponse = await fetch(archiveUrl, {
            method: 'POST',
            ...fetchOpts,
            body: JSON.stringify({
                taskId: task.id,
                status: requestBody.status,
                agentId: ctx.agentId || undefined
            })
        })
        if (!archiveResponse.ok) {
            const errorData = await archiveResponse.json().catch(() => null)
            throw new Error(
                toErrorMessage(
                    errorData,
                    `Archive/status update failed: ${archiveResponse.status}`
                )
            )
        }
        await archiveResponse.json().catch(() => null)
    }
}
