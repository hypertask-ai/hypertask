import { z } from 'zod';

/** Input for listing the custom fields defined on one board. */
export function getListCustomFieldsBaseSchema() {
  return z
    .object({
      project_id: z.coerce
        .number()
        .int()
        .positive('project_id must be a positive integer')
        .describe('Numeric ID of the board/project whose fields should be listed.'),
    })
    .strict();
}

export const ListCustomFieldsInputSchema = getListCustomFieldsBaseSchema();
export type ListCustomFieldsInput = z.infer<
  typeof ListCustomFieldsInputSchema
>;

/**
 * Base object for FastMCP tool parameters. The execution schema below enforces
 * that callers identify the field by exactly one supported method.
 */
export function getSetCustomFieldValueBaseSchema() {
  return z
    .object({
      task_id: z.coerce
        .number()
        .int()
        .positive('task_id must be a positive integer')
        .describe('Numeric ID of the task that receives the field value.'),
      field_id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('ID of an existing custom field on the task\'s board.'),
      field_name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          'Name of a custom field on the task\'s board. A missing field is auto-created as a Number field when setting a non-empty value.'
        ),
      value: z
        .union([z.string(), z.number().finite(), z.null()])
        .describe(
          'Value to write. Select fields accept an option ID or label; null or an empty string clears the value.'
        ),
    })
    .strict();
}

export function getSetCustomFieldValueInputSchema() {
  return getSetCustomFieldValueBaseSchema().refine(
    (data) =>
      (data.field_id === undefined) !== (data.field_name === undefined),
    {
      message: 'Provide exactly one of field_id or field_name',
      path: ['field_id', 'field_name'],
    }
  );
}

export const SetCustomFieldValueInputSchema =
  getSetCustomFieldValueInputSchema();
export type SetCustomFieldValueInput = z.infer<
  typeof SetCustomFieldValueInputSchema
>;
