import { getGetTasksBaseSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: get_tasks
 * Gets detailed information about a single or multiple tasks by ID or ticket number.
 * 
 * The base schema describes the wire arguments; TaskService validates
 * identifier refinements after input normalization.
 */
const GetTasksBaseSchema = getGetTasksBaseSchema();

export const getTasksTool = {
  name: TOOL_METADATA.GET_TASKS.name,
  description: TOOL_METADATA.GET_TASKS.description,
  parameters: GetTasksBaseSchema,
  execute: async (args: unknown, context: any) => {
    // Normalize input to handle URLs (extract project_id + unique_index from URLs)
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
