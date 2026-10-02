import { toErrorMessage } from "@/lib/api/errorMessage";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskDueDate(context: TaskUpdateFieldContext, task: TaskUpdateTarget, dueDateValue: Date | null | undefined) {
    const { requestBody, hasDueDate, baseUrl, ctx, authCookieHeader } = context;
    const fetchOpts = {
        headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookieHeader
        }
    }
    if (hasDueDate) {
        const setDueDateUrl = `${baseUrl}/api/tasks/setDueDate`
        const dueDateResponse = await fetch(setDueDateUrl, {
            method: 'POST',
            ...fetchOpts,
            body: JSON.stringify({
                taskId: task.id,
                dueDate: dueDateValue ?? null,
                agentId: ctx.agentId || undefined,
            }),
        })
        if (!dueDateResponse.ok) {
            const errorData = await dueDateResponse.json().catch(() => null)
            throw new Error(
                toErrorMessage(
                    errorData,
                    `Due date update failed: ${dueDateResponse.status}`
                )
            )
        }
        await dueDateResponse.json().catch(() => null)
    }
}
