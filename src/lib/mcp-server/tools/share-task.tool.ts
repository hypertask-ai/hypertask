import { ShareTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const shareTaskTool = {
  name: TOOL_METADATA.SHARE_TASK.name,
  description: TOOL_METADATA.SHARE_TASK.description,
  parameters: ShareTaskInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'shareTask',
    args,
  ),
};
