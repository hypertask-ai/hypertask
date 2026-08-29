import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import { getSearchPagesInputSchema } from '../validations/page.validation';

/**
 * Tool: search_pages
 * Searches rich documents across the caller's accessible pages.
 */
export const searchPagesTool = {
  name: TOOL_METADATA.SEARCH_PAGES.name,
  description: TOOL_METADATA.SEARCH_PAGES.description,
  parameters: getSearchPagesInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, PageService, 'searchPages', args);
  },
};
