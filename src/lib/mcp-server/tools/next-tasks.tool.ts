import { getNextTasksInputSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: next_tasks
 * Gets the highest-priority unleased tasks on a board.
 */
export const nextTasksTool = {
  name: TOOL_METADATA.NEXT_TASKS.name,
  description: TOOL_METADATA.NEXT_TASKS.description,
  parameters: getNextTasksInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, TaskService, 'getNextTasks', args);
  },
};
