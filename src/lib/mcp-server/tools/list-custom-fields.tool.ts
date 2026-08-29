import { TOOL_METADATA } from '../config/tool-metadata';
import { CustomFieldService } from '../lib/services/custom-field.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getListCustomFieldsBaseSchema,
  ListCustomFieldsInputSchema,
} from '../validations/custom-field.validation';

/** Tool: list_custom_fields — lists the fields defined on one board. */
export const listCustomFieldsTool = {
  name: TOOL_METADATA.LIST_CUSTOM_FIELDS.name,
  description: TOOL_METADATA.LIST_CUSTOM_FIELDS.description,
  parameters: getListCustomFieldsBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = ListCustomFieldsInputSchema.parse(args);
    return executeWithService(
      context,
      CustomFieldService,
      'listCustomFields',
      validatedInput
    );
  },
};
