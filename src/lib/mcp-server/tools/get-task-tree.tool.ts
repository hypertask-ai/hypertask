import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getGetTaskTreeBaseSchema } from '../validations/task.validation';

export const getTaskTreeTool = {
  name: TOOL_METADATA.GET_TASK_TREE.name,
  description: TOOL_METADATA.GET_TASK_TREE.description,
  parameters: getGetTaskTreeBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(
      context,
      TaskService,
      'getTaskTree',
      validatedInput
    );
  },
};
