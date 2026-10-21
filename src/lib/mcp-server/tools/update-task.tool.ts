import { getUpdateTaskBaseSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';
import { normalizeTaskInput } from '../utils/normalize-task-input';

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
    const normalizedArgs = normalizeTaskInput(args as Record<string, any>);
    
    const validatedInput = normalizedArgs;
    
    return executeWithService(
      context,
      TaskService,
      (service) => service.updateTask(validatedInput, invocation),
      validatedInput
    );
  },
};
