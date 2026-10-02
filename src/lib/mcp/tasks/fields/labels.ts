import { mutateTaskLabels, setTaskLabels } from "@/lib/mcp/tasks/services";
import type { TaskUpdateFieldContext, TaskUpdateTarget, TaskUpdateActingAgent } from './types';

export async function updateTaskLabels(context: TaskUpdateFieldContext, task: TaskUpdateTarget, actingAgent: TaskUpdateActingAgent) {
    const { requestBody, hasLabels, hasLabelMutation, userObj } = context;
    // Handle labels (replace all)
    if (hasLabels) {
        try {
            await setTaskLabels(
                task.id,
                task.projectId,
                requestBody.labels!,
                userObj,
                actingAgent
            );
        } catch (labelError) {
            console.warn(`[MCP Update Task] Failed to update labels for task ${task.id}:`, labelError);
            throw labelError;
        }
    }

    // Handle additive/subtractive label changes (leaves other labels intact)
    if (hasLabelMutation) {
        try {
            await mutateTaskLabels(
                task.id,
                task.projectId,
                {
                    add: requestBody.add_labels,
                    remove: requestBody.remove_labels,
                    skipIfPresent: requestBody.skip_if_labels_present,
                },
                userObj,
                actingAgent
            );
        } catch (labelError) {
            console.warn(`[MCP Update Task] Failed to mutate labels for task ${task.id}:`, labelError);
            throw labelError;
        }
    }
}
