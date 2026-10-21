import { getCreateTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';
import { normalizeCreateTaskInput } from '../utils/normalize-task-input';

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
    const normalizedArgs = normalizeCreateTaskInput((args || {}) as Record<string, any>);
    const validatedInput = normalizedArgs;

    return executeWithService(
      context,
      TaskService,
      (service) => service.createTask(validatedInput, invocation),
      validatedInput
    );
  },
};
