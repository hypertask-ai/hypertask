import { getAssignUserBaseSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

export const assignUserTool = {
  name: TOOL_METADATA.ASSIGN_USER.name,
  description: TOOL_METADATA.ASSIGN_USER.description,
  parameters: getAssignUserBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    const validatedInput = normalizedArgs;

    return executeWithService(context, TaskService, 'assignUser', validatedInput);
  },
};
