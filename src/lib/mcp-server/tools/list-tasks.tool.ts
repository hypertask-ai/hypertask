import { getListTasksInputSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

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
