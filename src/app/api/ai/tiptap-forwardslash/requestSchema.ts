import { z } from "zod";

export const tiptapForwardSlashRequestSchema = z
  .object({
    content: z.string().optional().default(""),
    command: z.string().trim().min(1),
    instruction: z.string().trim().min(1).max(2_000).optional(),
    projectId: z.coerce.number().int().positive().nullable().optional(),
    taskId: z.coerce.number().int().positive().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.command === "CustomEdit" || value.command === "WriteContent") &&
      !value.instruction
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instruction"],
        message: "An instruction is required for custom AI writing",
      });
    }

    if (!value.content && value.command !== "WriteContent") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Content is required for AI editing",
      });
    }
  });

export type TiptapForwardSlashRequest = z.infer<
  typeof tiptapForwardSlashRequestSchema
>;
