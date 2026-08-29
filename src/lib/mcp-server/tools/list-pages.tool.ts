import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import { getListPagesInputSchema } from '../validations/page.validation';

/**
 * Tool: list_pages
 * Lists rich documents for a task or project.
 */
export const listPagesTool = {
  name: TOOL_METADATA.LIST_PAGES.name,
  description: TOOL_METADATA.LIST_PAGES.description,
  parameters: getListPagesInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, PageService, 'listPages', args);
  },
};
