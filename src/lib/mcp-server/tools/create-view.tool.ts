import { getCreateViewInputSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const createViewTool = {
  name: TOOL_METADATA.CREATE_VIEW.name,
  description: TOOL_METADATA.CREATE_VIEW.description,
  parameters: getCreateViewInputSchema(),
  execute: async (args: unknown, context: any) => {
    return executeWithService(context, ViewService, 'createView', args);
  },
};
