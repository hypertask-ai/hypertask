import { getEnhancedSearchTasksInputSchema } from '../validations/task.validation';
import { SearchService } from '../lib/services/search.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: search_tasks
 * Searches for tasks by name, description, or ticket number with enhanced filtering.
 * Results are automatically limited to boards/projects the user has access to.
 */
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
