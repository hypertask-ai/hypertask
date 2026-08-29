import { getCreateTaskInputSchema, CreateTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';
import { normalizeCreateTaskInput } from '../utils/normalize-task-input';

/**
 * Tool: create_task
 * Creates a new task in a project.
 *
 * Required: project_id and title
 * Optional: description, section_id, priority, estimate
 */
const CreateTaskSchema = getCreateTaskInputSchema();

export const createTaskTool = {
  name: TOOL_METADATA.CREATE_TASK.name,
  description: TOOL_METADATA.CREATE_TASK.description,
  parameters: CreateTaskSchema,
  execute: async (
    args: unknown,
    context: any,
    invocation?: { requestId: string; clientFingerprint: string }
  ) => {
    // Normalize input (coerce project_id/section_id from strings - AI agents sometimes pass "1511")
    const normalizedArgs = normalizeCreateTaskInput((args || {}) as Record<string, any>);
    const validatedInput = CreateTaskInputSchema.parse(normalizedArgs);

    return executeWithService(
      context,
      TaskService,
      (service) => service.createTask(validatedInput, invocation),
      validatedInput
    );
  },
};
