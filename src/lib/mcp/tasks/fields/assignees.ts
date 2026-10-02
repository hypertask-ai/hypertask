import prisma from "@/lib/prisma";
import { clearHumanAssignees } from "@/utils/controllers/assignees/assign";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskAssignees(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { assigneeUserIds, clearAssignees, userObj, ctx, assignAssignees, request, baseUrl, strictSideEffectFailures } = context;
    // Assignees via MCP route (validates project membership for all user ids)
    if (assigneeUserIds !== undefined) {
        if (assigneeUserIds.length === 0) {
            if (clearAssignees) {
                await clearAssignees({
                    taskId: task.id,
                    user: userObj,
                    agentId: ctx.agentId,
                });
            } else {
                const clearResult = await clearHumanAssignees(
                    userObj,
                    task.id,
                    ctx.agentId ?? undefined
                );
                if (clearResult.status !== 200) {
                    throw new Error(
                        (clearResult.json as { message?: string }).message ??
                            'Failed to clear assignees'
                    );
                }
            }
            return { success: true, taskId: task.id };
        }

        const updateAssignees = async (
            userIds: number[],
            intent: 'assign' | 'unassign'
        ) => {
            if (userIds.length === 0) return;

            try {
                if (assignAssignees) {
                    await assignAssignees({
                        taskId: task.id,
                        projectId: task.projectId,
                        userIds,
                        intent,
                        user: userObj,
                        agentId: ctx.agentId,
                    });
                    return;
                }

                const mcpAuthorization = request.headers.get('Authorization')
                if (!mcpAuthorization?.startsWith('Bearer ')) {
                    throw new Error('Missing Authorization for assignee update');
                }
                const assignUrl = `${baseUrl}/api/mcp/assignees/assign`;
                const assignResponse = await fetch(assignUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: mcpAuthorization,
                    },
                    body: JSON.stringify({
                        task_id: task.id,
                        user_ids: userIds,
                        mode: 'multiple',
                        intent,
                    }),
                });
                if (!assignResponse.ok) {
                    const errorData = await assignResponse
                        .json()
                        .catch(() => ({ error: `Failed to ${intent} users` }));
                    throw new Error(
                        (errorData as { error?: string; message?: string }).error ||
                            (errorData as { message?: string }).message ||
                            `${intent === 'assign' ? 'Assign' : 'Unassign'} failed: ${assignResponse.status}`
                    );
                }
                await assignResponse.json().catch(() => null);
            } catch (assignErr) {
                console.warn(
                    `[MCP Update Task] Failed to ${intent} users for task ${task.id}:`,
                    assignErr
                );
                if (strictSideEffectFailures) throw assignErr;
            }
        };

        let currentHumanAssignees: { userId: number }[] | null = null;
        try {
            currentHumanAssignees = await prisma.assignees.findMany({
                where: { taskId: task.id, agentId: null },
                select: { userId: true },
            });
        } catch (assigneeReadErr) {
            console.warn(
                `[MCP Update Task] Failed to read assignees for task ${task.id}:`,
                assigneeReadErr
            );
            if (strictSideEffectFailures) throw assigneeReadErr;
        }

        if (!currentHumanAssignees) {
            // Could not read the current list, so reconciling would drop
            // everyone or no one at random. Fall back to the old additive
            // behaviour rather than silently assigning nobody.
            await updateAssignees(assigneeUserIds, 'assign');
        } else {
            const requestedUserIds = new Set(assigneeUserIds);
            const currentUserIds = new Set(
                currentHumanAssignees.map((assignee) => assignee.userId)
            );
            const userIdsToUnassign = [...currentUserIds].filter(
                (userId) => !requestedUserIds.has(userId)
            );
            const userIdsToAssign = assigneeUserIds.filter(
                (userId) => !currentUserIds.has(userId)
            );

            await updateAssignees(userIdsToUnassign, 'unassign');
            await updateAssignees(userIdsToAssign, 'assign');
        }
    }
}
