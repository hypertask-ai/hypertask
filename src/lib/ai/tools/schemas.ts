import { z } from "zod";

export function inlineAgentImageFields(enabled = false) {
  const fields = {
    inline_images: z.boolean().optional().describe("Set false only when the user explicitly requests attachment only or link only; images are embedded inline by default."),
    image_urls: z.array(z.string().url()).optional().describe("Image URLs to include in this write only. Reference uploaded image URLs explicitly; never include unrelated images from the conversation."),
  };
  return enabled ? fields : {} as typeof fields;
}

export const getCreateTaskItemSchema = (inlineImages = false) => z.object({
  project_id: z.coerce.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
  ...inlineAgentImageFields(inlineImages),
  section: z
    .union([z.coerce.number().int().positive(), z.string().min(1)])
    .optional(),
  priority: z
    .enum(["No Priority", "Urgent", "High", "Medium", "Low"])
    .optional(),
  due_date: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignee_ids: z.array(z.coerce.number().int().positive()).optional(),
  parent_task_id: z.coerce.number().int().positive().nullable().optional(),
});

export const createTaskItemSchema = getCreateTaskItemSchema();

export type CreateTaskItemInput = z.infer<typeof createTaskItemSchema>;
