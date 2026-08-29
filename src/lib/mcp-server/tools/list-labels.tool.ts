import { ProjectService } from '../lib/services/project.service';
import { executeWithService } from '../utils/executeWithService';
import { TOOL_METADATA } from '../config/tool-metadata';
import {
  getListLabelsBaseSchema,
  ListLabelsInputSchema,
} from '../validations/project.validation';

/**
 * Tool: list_labels
 * Lists the labels available on one project/board.
 */
export const listLabelsTool = {
  name: TOOL_METADATA.LIST_LABELS.name,
  description: TOOL_METADATA.LIST_LABELS.description,
  parameters: getListLabelsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = ListLabelsInputSchema.parse(args);
    return executeWithService(
      context,
      ProjectService,
      'listLabels',
      validatedInput
    );
  },
};
