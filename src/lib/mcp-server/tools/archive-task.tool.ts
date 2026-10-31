import { ArchiveTaskInputSchema } from '../validations/task.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { TaskService } from '../lib/services/task.service';

export const archiveTaskTool = {
  name: TOOL_METADATA.ARCHIVE_TASK.name,
  description: TOOL_METADATA.ARCHIVE_TASK.description,
  parameters: ArchiveTaskInputSchema,
  execute: async (args: unknown, context: any) => executeWithService(
    context,
    TaskService,
    'archiveTask',
    args,
  ),
};
