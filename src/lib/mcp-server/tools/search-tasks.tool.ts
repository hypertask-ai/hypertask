import { getEnhancedSearchTasksInputSchema } from '../validations/task.validation';
import { SearchService } from '../lib/services/search.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const searchTasksTool = {
  name: TOOL_METADATA.SEARCH_TASKS.name,
  description: TOOL_METADATA.SEARCH_TASKS.description,
  parameters: getEnhancedSearchTasksInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(
      context,
      SearchService,
      'searchTasks',
      args
    );
  },
};
