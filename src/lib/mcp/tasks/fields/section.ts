import { toErrorMessage } from "@/lib/api/errorMessage";
import { isFeatureEnabled } from '@/lib/flags';
import { HTPR_7990_TASK_MOVE_REFUSAL_FLAG } from '@/lib/flags/definitions/htpr-7990-task-move-refusal';
import { HTPR_9050_SECTION_COLUMNS_FLAG } from '@/lib/flags/definitions/htpr-9050-section-columns';
import { boardColumnsLine, visibleBoardColumns } from '@/lib/mcp/boards/sectionLookup';
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

const columnLines = new WeakMap<TaskUpdateFieldContext, Map<number, Promise<string>>>();

function columnLine(context: TaskUpdateFieldContext, projectId: number): Promise<string> {
    let lines = columnLines.get(context);
    if (!lines) {
        lines = new Map();
        columnLines.set(context, lines);
    }
    const cached = lines.get(projectId);
    if (cached) return cached;
    const line = isFeatureEnabled(HTPR_9050_SECTION_COLUMNS_FLAG, context.user.id).then(
        async (enabled) => enabled ? boardColumnsLine(await visibleBoardColumns(projectId)) : ''
    );
    lines.set(projectId, line);
    return line;
}

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
                agentId: ctx.agentId || undefined,
                expectedSectionId: requestBody.expected_section_id,
                expectedUpdatedAt: requestBody.expected_updated_at
            })
        })
        if (!moveResponse.ok) {
            const errorData = await moveResponse.json().catch(() => null)
            const error = new Error(
                toErrorMessage(
                    errorData,
                    `Move task failed: ${moveResponse.status}`
                )
            )
            if (moveResponse.status >= 400 && moveResponse.status < 500 &&
                (requestBody.expected_section_id !== undefined || await isFeatureEnabled(HTPR_7990_TASK_MOVE_REFUSAL_FLAG, ctx.user.id))) {
                throw Object.assign(error, { status: moveResponse.status, code: 'task_move_refused' })
            }
            throw error
        }
        await moveResponse.json().catch(() => null)
    } else if (requestBody.sectionId && sectionInfo && sectionInfo.projectId !== task.projectId) {
        throw Object.assign(
            new Error(`sectionId must be a column on the task's own board. Use hypertask_move_task_between_boards to move a task to another board.${await columnLine(context, task.projectId)}`),
            { status: 400, code: 'invalid_value', field: 'sectionId' }
        )
    } else if (requestBody.sectionId && !sectionInfo) {
        throw Object.assign(
            new Error(`sectionId does not match a column. Pass a column id from the task's own board.${await columnLine(context, task.projectId)}`),
            { status: 400, code: 'not_found', field: 'sectionId' }
        )
    }
}
