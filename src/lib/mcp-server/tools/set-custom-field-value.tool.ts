import { TOOL_METADATA } from '../config/tool-metadata';
import { CustomFieldService } from '../lib/services/custom-field.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getSetCustomFieldValueBaseSchema,
  SetCustomFieldValueInputSchema,
} from '../validations/custom-field.validation';

/** Tool: set_custom_field_value — writes or clears one field value on one task. */
export const setCustomFieldValueTool = {
  name: TOOL_METADATA.SET_CUSTOM_FIELD_VALUE.name,
  description: TOOL_METADATA.SET_CUSTOM_FIELD_VALUE.description,
  parameters: getSetCustomFieldValueBaseSchema(),
  execute: async (args: unknown, context: any) => {
    const validatedInput = SetCustomFieldValueInputSchema.parse(args);
    return executeWithService(
      context,
      CustomFieldService,
      'setCustomFieldValue',
      validatedInput
    );
  },
};
