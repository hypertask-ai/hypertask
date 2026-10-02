
import { z } from "zod";

import { TOOL_TASK_ID_DESCRIPTION, MAX_BULK_TOOL_TARGETS, bulkTaskTargetCount } from "@/lib/ai/tools/constants";

export const updateTaskSchema = z
  .object({
    task_id: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(TOOL_TASK_ID_DESCRIPTION),
    task_ids: z
      .array(z.coerce.number().int().positive())
      .max(MAX_BULK_TOOL_TARGETS)
      .optional(),
    ticket_number: z.string().optional(),
    ticket_numbers: z
      .array(z.string())
      .max(MAX_BULK_TOOL_TARGETS)
      .optional(),
    unique_index: z.coerce.number().int().positive().optional(),
    project_id: z.coerce.number().int().positive().optional(),
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(20000).optional(),
    priority: z
      .enum(["No Priority", "Urgent", "High", "Medium", "Low"])
      .optional(),
    estimate: z.coerce
      .number()
      .int()
      .refine((value) => [0, 2, 3, 4, 5, 6].includes(value), {
        message: "estimate must be one of 0, 2, 3, 4, 5, 6",
      })
      .optional()
      .describe(
        "Story-point estimate. Allowed values: 0 (none), 2, 3, 4, 5, 6."
      ),
    due_date: z.string().nullable().optional(),
    status: z.enum(["Normal", "Archive", "Deleted"]).optional(),
    parent_task_id: z.coerce.number().int().positive().nullable().optional(),
    section: z
      .union([z.coerce.number().int().positive(), z.string().min(1)])
      .optional()
      .describe(
        "Only pass section when the user explicitly asks to move the task to a different section/column. Never infer it."
      ),
    labels: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe(
        "Label names or ids. This REPLACES every label on the task, so any label not listed here is removed. To add or remove a single tag while keeping the others, use add_labels/remove_labels instead."
      ),
    add_labels: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe(
        "Label names or ids to add, leaving the task's other labels untouched."
      ),
    remove_labels: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe(
        "Label names or ids to remove, leaving the task's other labels untouched."
      ),
    confirmed: z
      .boolean()
      .optional()
      .describe(
        "Set true ONLY after the user has explicitly approved this exact wide/destructive write in their own message. Never set it to confirm your own proposal."
      ),
  })
  .refine(
    (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
    {
      message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
      path: ["task_ids"],
    }
  );
