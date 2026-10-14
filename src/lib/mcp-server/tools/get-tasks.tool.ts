import { getGetTasksBaseSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

const GetTasksBaseSchema = getGetTasksBaseSchema();

export const getTasksTool = {
  name: TOOL_METADATA.GET_TASKS.name,
  description: TOOL_METADATA.GET_TASKS.description,
  parameters: GetTasksBaseSchema,
  execute: async (args: unknown, context: any) => {
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    const validatedInput = normalizedArgs;
    
    return executeWithService(
      context,
      TaskService,
      'getTask',
      validatedInput
    );
  },
};
