import { getDeleteViewInputSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: delete_view
 * Deletes a saved board view by ID.
 */
export const deleteViewTool = {
  name: TOOL_METADATA.DELETE_VIEW.name,
  description: TOOL_METADATA.DELETE_VIEW.description,
  parameters: getDeleteViewInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ViewService, 'deleteView', args);
  },
};
