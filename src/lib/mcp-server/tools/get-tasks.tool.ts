import { getGetTasksBaseSchema, GetTaskInputSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: get_tasks
 * Gets detailed information about a single or multiple tasks by ID or ticket number.
 * 
 * Note: We use the base schema (without refine) for FastMCP parameters,
 * then validate the refine logic (task_id OR ticket_number) in execute.
 */
const GetTasksBaseSchema = getGetTasksBaseSchema();

export const getTasksTool = {
  name: TOOL_METADATA.GET_TASKS.name,
  description: TOOL_METADATA.GET_TASKS.description,
  parameters: GetTasksBaseSchema,
  execute: async (args: unknown, context: any) => {
    // Normalize input to handle URLs (extract project_id + unique_index from URLs)
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    
    // Validate with full schema (including refine)
    const validatedInput = GetTaskInputSchema.parse(normalizedArgs);
    
    return executeWithService(
      context,
      TaskService,
      'getTask',
      validatedInput
    );
  },
};
