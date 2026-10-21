import { HelpDocsService } from '../lib/services/help-docs.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import { getSearchHelpDocsBaseSchema } from '../validations/help-docs.validation';

export const searchHelpDocsTool = {
  name: TOOL_METADATA.SEARCH_HELP_DOCS.name,
  description: TOOL_METADATA.SEARCH_HELP_DOCS.description,
  parameters: getSearchHelpDocsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(
      context,
      HelpDocsService,
      'searchHelpDocs',
      validatedInput
    );
  },
};
