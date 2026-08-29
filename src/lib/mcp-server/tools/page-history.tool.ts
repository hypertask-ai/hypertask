import { TOOL_METADATA } from '../config/tool-metadata';
import { PageService } from '../lib/services/page.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getPageHistoryBaseSchema,
  PageHistoryInputSchema,
} from '../validations/page.validation';

export const pageHistoryTool = {
  name: TOOL_METADATA.PAGE_HISTORY.name,
  description: TOOL_METADATA.PAGE_HISTORY.description,
  parameters: getPageHistoryBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = PageHistoryInputSchema.parse(args);
    return executeWithService(
      context,
      PageService,
      'managePageHistory',
      validatedInput
    );
  },
};
