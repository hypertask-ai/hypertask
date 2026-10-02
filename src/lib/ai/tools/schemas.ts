import { z } from "zod";

export const createTaskItemSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
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

export type CreateTaskItemInput = z.infer<typeof createTaskItemSchema>;
