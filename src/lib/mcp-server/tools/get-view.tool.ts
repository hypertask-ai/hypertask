import { getViewInputSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const getViewTool = {
  name: TOOL_METADATA.GET_VIEW.name,
  description: TOOL_METADATA.GET_VIEW.description,
  parameters: getViewInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ViewService, 'getView', args);
  },
};
