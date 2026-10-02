import prisma from "@/lib/prisma";
import { assertAgentAssignmentChangeAllowed } from "@/lib/mcp/tasks/agentMutationFence";
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

export async function updateTaskContract(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { hasContractFieldUpdate, ctx, user, contractFieldUpdates } = context;
    if (hasContractFieldUpdate) {
        try {
            await prisma.$transaction(async (tx) => {
                await assertAgentAssignmentChangeAllowed(
                    tx,
                    task.id,
                    ctx.agentId,
                    user.id,
                    { allowHumanOverride: !ctx.agentId },
                );
                await tx.task.update({
                    where: { id: task.id },
                    data: { ...contractFieldUpdates, updatedAt: new Date() },
                });
            });
        } catch (contractFieldError) {
            console.warn(`[MCP Update Task] Failed to update contract fields for task ${task.id}:`, contractFieldError);
            throw contractFieldError;
        }
    }
}
