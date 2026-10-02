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
    // 1. Section change (same board): use moveTask for activity + notifications
    if (requestBody.sectionId && sectionInfo && sectionInfo.projectId === task.projectId) {
        const moveTaskUrl = `${baseUrl}/api/tasks/moveTask`
        const moveResponse = await fetch(moveTaskUrl, {
            method: 'PUT',
            ...fetchOpts,
            body: JSON.stringify({
                taskId: task.id,
                section_title: sectionInfo.section_title,
                sectionId: requestBody.sectionId,
                projectId: task.projectId,
                agentId: ctx.agentId || undefined
                // ranking omitted - moveTask computes it
            })
        })
        if (!moveResponse.ok) {
            // A body that fails to parse must not mask the HTTP status:
            // a fabricated message here replaced the status-bearing
            // fallback and reached the CLI as a bare "Failed to move
            // task" (HTPR-6224).
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
