import { FollowTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const followTaskTool = {
  name: TOOL_METADATA.FOLLOW_TASK.name,
  description: TOOL_METADATA.FOLLOW_TASK.description,
  parameters: FollowTaskInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'followTask',
    args,
  ),
};
