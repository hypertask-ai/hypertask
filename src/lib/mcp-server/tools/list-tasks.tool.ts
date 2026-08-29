import { getListTasksInputSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: list_tasks
 * Lists tasks with comprehensive filtering options.
 * Results are automatically limited to boards/projects the user has access to.
 */
export const listTasksTool = {
  name: TOOL_METADATA.LIST_TASKS.name,
  description: TOOL_METADATA.LIST_TASKS.description,
  parameters: getListTasksInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      TaskService,
      'listTasks',
      args
    );
  },
};
