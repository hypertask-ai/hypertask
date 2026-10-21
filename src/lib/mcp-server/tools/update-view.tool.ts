import { getUpdateViewBaseSchema } from '../validations/view.validation';
import { ViewService } from '../lib/services/view.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';

export const updateViewTool = {
  name: TOOL_METADATA.UPDATE_VIEW.name,
  description: TOOL_METADATA.UPDATE_VIEW.description,
  parameters: getUpdateViewBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = args;
    return executeWithService(context, ViewService, 'updateView', validatedInput);
  },
};
