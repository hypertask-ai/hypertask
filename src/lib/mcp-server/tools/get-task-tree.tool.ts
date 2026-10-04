import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getGetTaskTreeBaseSchema } from '../validations/task.validation';

/**
 * Tool: get_task_tree
 * Returns the parent/subtask tree for a task from its topmost ancestor.
 */
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
