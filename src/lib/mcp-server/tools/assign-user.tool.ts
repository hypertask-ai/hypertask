import { AssignUserInputSchema, getAssignUserBaseSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: assign_user
 * Assigns (idempotent) or unassigns via intent; see tool description.
 */
export const assignUserTool = {
  name: TOOL_METADATA.ASSIGN_USER.name,
  description: TOOL_METADATA.ASSIGN_USER.description,
  parameters: getAssignUserBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    const validatedInput = AssignUserInputSchema.parse(normalizedArgs);

    return executeWithService(context, TaskService, 'assignUser', validatedInput);
  },
};
