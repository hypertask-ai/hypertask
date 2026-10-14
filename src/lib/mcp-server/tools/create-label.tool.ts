import { CreateLabelInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { ProjectService } from '../lib/services/project.service';

export const createLabelTool = {
  name: TOOL_METADATA.CREATE_LABEL.name,
  description: TOOL_METADATA.CREATE_LABEL.description,
  parameters: CreateLabelInputSchema,
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = args;
    return executeWithService(context, ProjectService, 'createLabel', validatedInput);
  },
};
