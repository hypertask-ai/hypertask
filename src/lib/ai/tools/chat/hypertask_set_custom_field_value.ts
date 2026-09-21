import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskSetCustomFieldValueTool(context: ChatToolContext) {
  const { CustomFieldType, TOOL_TASK_ID_DESCRIPTION, createCustomField, getCustomFieldForProjectByName, getCustomFieldsForProject, resolveTaskForTool, sanitizeForJson, sendStatus, tool, upsertCustomFieldValue, user, withToolErrors, z } = context;
  return tool({
      description:
        'Set or clear a custom field\'s value on a task, e.g. "set ICE to 21 on THID-5". Pass create_field=true to explicitly create a missing Number-type field. Pass value: null (or an empty string) to clear an existing field.',
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z
          .string()
          .optional()
          .describe(
            "Ticket number such as HTPR-1234. Prefer this when the user gives a ticket number; do not also invent task_id."
          ),
        unique_index: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Task's board-local numeric index. Only pass with project_id; do not use it by itself."
          ),
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Project/board id required with unique_index and useful to disambiguate ticket_number. Omit when only task_id is known."
          ),
        field_name: z
          .string()
          .min(1)
          .describe(
            'Custom field name, e.g. "ICE". Must match an existing field unless create_field=true.'
          ),
        create_field: z
          .boolean()
          .optional()
          .describe(
            "Set true only when the user explicitly asks to create this missing field. New fields created here are Number fields."
          ),
        value: z
          .union([z.string(), z.number(), z.null()])
          .describe(
            "New value for the field. For Select fields, pass the option id or label. Pass null or an empty string to clear the field."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_set_custom_field_value");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }
        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const fieldName = input.field_name.trim();
        if (!fieldName) {
          return { success: false, error: "field_name is required" };
        }

        const normalizedValue = input.value === null ? null : String(input.value);

        let customField = await getCustomFieldForProjectByName(
          task.projectId,
          fieldName
        );
        if (
          !customField &&
          input.create_field &&
          normalizedValue !== null &&
          normalizedValue !== ""
        ) {
          customField = await createCustomField(
            task.projectId,
            fieldName,
            CustomFieldType.Number
          );
        }

        if (!customField) {
          const validFields = (await getCustomFieldsForProject(task.projectId))
            .map((field) => field.name)
            .join(", ");
          return {
            success: false,
            error:
              normalizedValue === null || normalizedValue === ""
                ? `Cannot clear unknown custom field "${fieldName}". Valid fields: ${validFields || "none"}.`
                : `Unknown custom field "${fieldName}". Valid fields: ${validFields || "none"}. Pass create_field=true only if the user explicitly asked to create it.`,
          };
        }

        const customFieldValue = await upsertCustomFieldValue(
          customField.id,
          task.id,
          normalizedValue
        );

        return sanitizeForJson({
          success: true,
          taskId: task.id,
          customField: {
            id: customField.id,
            name: customField.name,
            type: customField.type,
          },
          customFieldValue,
          ...(customFieldValue === null ? { deleted: true } : {}),
        });
      }),
    });
}
