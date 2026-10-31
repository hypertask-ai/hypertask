import { GetTaskShareInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const getTaskShareTool = {
  name: TOOL_METADATA.GET_TASK_SHARE.name,
  description: TOOL_METADATA.GET_TASK_SHARE.description,
  parameters: GetTaskShareInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'getTaskShare',
    args,
  ),
};
