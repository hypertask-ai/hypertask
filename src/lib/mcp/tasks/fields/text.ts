import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { persistUrlsForDescription } from "@/utils/controllers/urls/extractUrlsFromContent";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { fetchTaskSave, isTaskSaveTimeout, taskSaveBudget } from "@/lib/tasks/saveLimit";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskText(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const budget = taskSaveBudget();
    let saved = false;
    try {
    return await budget.run(async () => {
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
        const sanitizedDescription = hasDescriptionUpdate
            ? await inlineAgentImagesForUser(sanitizeRichHtml(requestBody.description ?? ''), ctx.user.id, { inlineImages: requestBody.inline_images })
            : undefined
        if (sanitizedDescription !== undefined) {
            newTask.description = sanitizedDescription
            newTask.inline_images = requestBody.inline_images
        }
        if (requestBody.parent_task_id !== undefined) newTask.parentTaskId = requestBody.parent_task_id

        const singleUrl = `${baseUrl}/api/tasks/single`
        const singleResponse = await fetchTaskSave(singleUrl, {
            method: 'PUT',
            redirect: 'manual',
            ...fetchOpts,
            body: JSON.stringify({
                newTask,
                agentId: ctx.agentId || undefined,
            })
        }, budget.remaining())
        if (!singleResponse.ok) {
            throw new Error(
                toErrorMessage(
                    singleResponse.data,
                    `Task update failed: ${singleResponse.status}`
                )
            )
        }
        saved = true;
        if (sanitizedDescription) {
            await persistUrlsForDescription(sanitizedDescription, task.id, [], { userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope })
        }
    }
    });
    } catch (error) {
        if (saved && isTaskSaveTimeout(error)) return;
        throw error;
    }
}
