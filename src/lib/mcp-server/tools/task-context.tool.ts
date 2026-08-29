import { getTaskContextInputSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: task_context
 * Gets a focused context pack for one task.
 */
export const taskContextTool = {
  name: TOOL_METADATA.TASK_CONTEXT.name,
  description: TOOL_METADATA.TASK_CONTEXT.description,
  parameters: getTaskContextInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, TaskService, 'getTaskContext', args);
  },
};
