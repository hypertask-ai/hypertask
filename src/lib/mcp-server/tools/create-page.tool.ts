import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import { getCreatePageInputSchema } from '../validations/page.validation';

/**
 * Tool: create_page
 * Creates a rich document attached to a task.
 */
export const createPageTool = {
  name: TOOL_METADATA.CREATE_PAGE.name,
  description: TOOL_METADATA.CREATE_PAGE.description,
  parameters: getCreatePageInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, PageService, 'createPage', args);
  },
};
