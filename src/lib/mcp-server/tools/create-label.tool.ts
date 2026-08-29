import { CreateLabelInputSchema } from '../validations/project.validation';
import { TOOL_METADATA } from '../config/tool-metadata';
import { executeWithService } from '../utils/executeWithService';
import { ProjectService } from '../lib/services/project.service';

/**
 * Tool: create_label
 * Creates a new label in a project (HTPR-3054).
 *
 * Required: project_id and name
 * Optional: color (hex format)
 */
export const createLabelTool = {
  name: TOOL_METADATA.CREATE_LABEL.name,
  description: TOOL_METADATA.CREATE_LABEL.description,
  parameters: CreateLabelInputSchema,
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = CreateLabelInputSchema.parse(args);
    return executeWithService(context, ProjectService, 'createLabel', validatedInput);
  },
};
