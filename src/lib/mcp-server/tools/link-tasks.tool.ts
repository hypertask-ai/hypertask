import { getLinkTasksBaseSchema } from '../validations/task.validation';
import { TaskService } from '../lib/services/task.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const linkTasksTool = {
  name: TOOL_METADATA.LINK_TASKS.name,
  description: TOOL_METADATA.LINK_TASKS.description,
  parameters: getLinkTasksBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(context, TaskService, 'linkTasks', validatedInput);
  },
};
