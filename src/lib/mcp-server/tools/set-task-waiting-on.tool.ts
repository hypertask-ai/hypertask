import { SetTaskWaitingOnInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const setTaskWaitingOnTool = {
  name: TOOL_METADATA.SET_TASK_WAITING_ON.name,
  description: TOOL_METADATA.SET_TASK_WAITING_ON.description,
  parameters: SetTaskWaitingOnInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'setTaskWaitingOn',
    args,
  ),
};
