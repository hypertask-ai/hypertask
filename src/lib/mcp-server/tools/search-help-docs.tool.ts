import { HelpDocsService } from '../lib/services/help-docs.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getSearchHelpDocsBaseSchema,
  SearchHelpDocsInputSchema,
} from '../validations/help-docs.validation';

/**
 * Tool: search_help_docs
 * Searches public Hypertask help-center articles for product documentation.
 */
export const searchHelpDocsTool = {
  name: TOOL_METADATA.SEARCH_HELP_DOCS.name,
  description: TOOL_METADATA.SEARCH_HELP_DOCS.description,
  parameters: getSearchHelpDocsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = SearchHelpDocsInputSchema.parse(args);
    return executeWithService(
      context,
      HelpDocsService,
      'searchHelpDocs',
      validatedInput
    );
  },
};
