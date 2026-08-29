import { getApplyViewInputSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

/**
 * Tool: switch_view
 * Applies a saved view as the caller's active board tab.
 */
export const switchViewTool = {
  name: TOOL_METADATA.SWITCH_VIEW.name,
  description: TOOL_METADATA.SWITCH_VIEW.description,
  parameters: getApplyViewInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ViewService, 'applyView', args);
  },
};
