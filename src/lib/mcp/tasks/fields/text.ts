import { persistUrlsForDescription } from "@/utils/controllers/urls/extractUrlsFromContent";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { toErrorMessage } from "@/lib/api/errorMessage";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskText(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { requestBody, hasTextOrParentUpdate, hasDescriptionUpdate, baseUrl, ctx, authCookieHeader } = context;
    const fetchOpts = {
        headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookieHeader
        }
    }
    if (hasTextOrParentUpdate) {
        const newTask: any = { id: task.id }
        if (requestBody.title !== undefined) newTask.title = requestBody.title
        // SECURITY: Sanitize MCP rich text before the legacy updater, and preserve explicit parent_task_id null clears from staging.
        const sanitizedDescription = hasDescriptionUpdate
            ? sanitizeRichHtml(requestBody.description ?? '')
            : undefined
        if (sanitizedDescription !== undefined) newTask.description = sanitizedDescription
        if (requestBody.parent_task_id !== undefined) newTask.parentTaskId = requestBody.parent_task_id

        const singleUrl = `${baseUrl}/api/tasks/single`
        const singleResponse = await fetch(singleUrl, {
            method: 'PUT',
            ...fetchOpts,
            body: JSON.stringify({
                newTask,
                agentId: ctx.agentId || undefined,
            })
        })
        if (!singleResponse.ok) {
            const errorData = await singleResponse.json().catch(() => null)
            throw new Error(
                toErrorMessage(
                    errorData,
                    `Task update failed: ${singleResponse.status}`
                )
            )
        }
        await singleResponse.json().catch(() => null)

        if (sanitizedDescription) {
            await persistUrlsForDescription(sanitizedDescription, task.id)
        }
    }
}
