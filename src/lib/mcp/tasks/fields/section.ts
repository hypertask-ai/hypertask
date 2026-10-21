import { toErrorMessage } from "@/lib/api/errorMessage";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskSection(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { requestBody, sectionInfo, baseUrl, ctx, authCookieHeader } = context;
    const fetchOpts = {
        headers: {
            'Content-Type': 'application/json',
            'Cookie': authCookieHeader
        }
    }
    if (requestBody.sectionId && sectionInfo && sectionInfo.projectId === task.projectId) {
        const moveTaskUrl = `${baseUrl}/api/tasks/moveTask`
        const moveResponse = await fetch(moveTaskUrl, {
            method: 'PUT',
            redirect: 'manual',
            ...fetchOpts,
            body: JSON.stringify({
                taskId: task.id,
                section_title: sectionInfo.section_title,
                sectionId: requestBody.sectionId,
                projectId: task.projectId,
                agentId: ctx.agentId || undefined
            })
        })
        if (!moveResponse.ok) {
            const errorData = await moveResponse.json().catch(() => null)
            throw new Error(
                toErrorMessage(
                    errorData,
                    `Move task failed: ${moveResponse.status}`
                )
            )
        }
        await moveResponse.json().catch(() => null)
    } else if (requestBody.sectionId && sectionInfo && sectionInfo.projectId !== task.projectId) {
        throw new Error('Section must belong to the same project. Use move endpoint for cross-board moves.')
    }
}
