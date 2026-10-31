import { DeleteTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const deleteTaskTool = {
  name: TOOL_METADATA.DELETE_TASK.name,
  description: TOOL_METADATA.DELETE_TASK.description,
  parameters: DeleteTaskInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'deleteTask',
    args,
  ),
};
