import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import { getGetPageBaseSchema } from '../validations/page.validation';

/**
 * Tool: get_page
 * Gets a rich document by numeric ID or publicId.
 */
export const getPageTool = {
  name: TOOL_METADATA.GET_PAGE.name,
  description: TOOL_METADATA.GET_PAGE.description,
  parameters: getGetPageBaseSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, PageService, 'getPage', args);
  },
};
