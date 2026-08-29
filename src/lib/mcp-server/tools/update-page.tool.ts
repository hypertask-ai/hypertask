import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import { getUpdatePageBaseSchema } from '../validations/page.validation';

/**
 * Tool: update_page
 * Renames a rich document or replaces, appends, or prepends its content.
 */
export const updatePageTool = {
  name: TOOL_METADATA.UPDATE_PAGE.name,
  description: TOOL_METADATA.UPDATE_PAGE.description,
  parameters: getUpdatePageBaseSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, PageService, 'updatePage', args);
  },
};
