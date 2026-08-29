import { getUpdateTaskBaseSchema, UpdateTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';
import { normalizeTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: update_task
 * Updates a task with new values for title, description, priority, estimate, etc.
 * 
 * Note: We use the base schema (without refine) for FastMCP parameters,
 * then validate the refine logic (task identification + at least one update field) in execute.
 */
const UpdateTaskBaseSchema = getUpdateTaskBaseSchema();

export const updateTaskTool = {
  name: TOOL_METADATA.UPDATE_TASK.name,
  description: TOOL_METADATA.UPDATE_TASK.description,
  parameters: UpdateTaskBaseSchema,
  execute: async (
    args: unknown,
    context: any,
    invocation?: { requestId: string; clientFingerprint: string }
  ) => {
    // Normalize input to handle URLs (extract project_id + unique_index from URLs)
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    
    // Validate with full schema (including refines)
    const validatedInput = UpdateTaskInputSchema.parse(normalizedArgs);
    
    return executeWithService(
      context,
      TaskService,
      (service) => service.updateTask(validatedInput, invocation),
      validatedInput
    );
  },
};
