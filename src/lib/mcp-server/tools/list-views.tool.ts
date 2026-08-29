import { getListViewsInputSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: list_views
 * Lists saved board views with optional project and visibility filters.
 */
export const listViewsTool = {
  name: TOOL_METADATA.LIST_VIEWS.name,
  description: TOOL_METADATA.LIST_VIEWS.description,
  parameters: getListViewsInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ViewService, 'listViews', args);
  },
};
