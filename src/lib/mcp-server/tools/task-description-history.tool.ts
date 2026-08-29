import { TOOL_METADATA } from '../config/tool-metadata';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getTaskDescriptionHistoryBaseSchema,
  TaskDescriptionHistoryInputSchema,
} from '../validations/task.validation';

export const taskDescriptionHistoryTool = {
  name: TOOL_METADATA.TASK_DESCRIPTION_HISTORY.name,
  description: TOOL_METADATA.TASK_DESCRIPTION_HISTORY.description,
  parameters: getTaskDescriptionHistoryBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = TaskDescriptionHistoryInputSchema.parse(args);
    return executeWithService(
      context,
      TaskService,
      'manageTaskDescriptionHistory',
      validatedInput
    );
  },
};
