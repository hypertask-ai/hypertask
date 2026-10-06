import { z } from "zod";
import { taskRelationSchema } from "./taskReads";

const id = z.number().int().positive();
const agentId = z.string().optional();
const dateInput = z.union([z.date(), z.string()]).nullish();

// The 6923 schemas deliberately accept legacy bodies with z.custom. These
// browser-safe contracts describe property callers without tightening server policy.
export const moveTaskBodySchema = z.object({
  taskId: id,
  projectId: id,
  sectionId: id,
  section_title: z.string(),
  section: z.string().optional(),
  ranking: z.string().optional(),
});
export const dueDateBodySchema = z.object({ taskId: id, dueDate: dateInput });
export const startDateBodySchema = z.object({ taskId: id, startDate: dateInput });
export const waitingOnBodySchema = z.object({ taskId: id, userId: id.nullable() });
export const priorityBodySchema = z.object({ taskId: id, priority_index: z.number().int(), Priority_Value: z.string() });
export const estimateBodySchema = z.object({ taskId: id, estimate_index: z.number().int(), estimate_value: z.string() });
export const assigneeBodySchema = z.object({
  taskId: id,
  userId: id.optional(),
  agentId,
  intent: z.enum(["assign", "unassign", "toggle"]).optional(),
});
export const labelBodySchema = z.object({ taskId: id, labelId: z.string() });

export const taskWriteErrorSchema = z.looseObject({ message: z.string(), error: z.string().optional() });
export const taskPropertyResponseSchema = taskRelationSchema.extend({
  section: z.string(),
  dueDate: z.string().nullable(),
  startDate: z.string().nullable(),
});
export const moveTaskResponseSchema = taskPropertyResponseSchema.extend({
  newComment: z.looseObject({ id }).optional(),
});
export const waitingOnResponseSchema = z.looseObject({
  id,
  waitingOnUserId: id.nullable(),
  waitingOnSetById: id.nullable(),
  waitingOnSetAt: z.string().nullable(),
});
const propertyRow = {
  id: z.string(),
  taskId: id,
  projectId: id,
  sectionId: z.number().int(),
  addedByUserId: id,
  addedByAgentId: z.string().nullable(),
  createdAt: z.string(),
};
const clearedPropertySchema = z.looseObject({ message: z.literal("Successfully deleted") });
export const priorityResponseSchema = z.union([
  z.looseObject({ ...propertyRow, priority_index: z.number().int(), Priority_Value: z.string() }),
  clearedPropertySchema,
]);
export const estimateResponseSchema = z.union([
  z.looseObject({ ...propertyRow, estimate_index: z.number().int(), estimate_value: z.string(), updatedAt: z.string().nullable() }),
  clearedPropertySchema,
]);
export const assigneeResponseSchema = z.looseObject({
  body: z.array(z.looseObject({
    id,
    taskId: id,
    userId: id,
    agentId: z.string().nullable(),
    user: z.looseObject({ id, displayName: z.string().nullable(), photoURL: z.string().nullable() }),
    agent: z.looseObject({ id: z.string(), displayName: z.string(), photoURL: z.string().nullable() }).nullable(),
  })),
  assignStatus: z.enum(["Assigned", "Unassigned", "Conflict"]),
});
export const labelResponseSchema = z.array(z.looseObject({
  id,
  taskId: id,
  labelId: z.string(),
  label: z.looseObject({ id: z.string(), value: z.string().nullable(), projectId: id.nullable(), createdAt: z.string(), ai_prompt: z.string().nullable() }),
}));

export type MoveTaskBody = z.input<typeof moveTaskBodySchema>;
export type DueDateBody = z.input<typeof dueDateBodySchema>;
export type StartDateBody = z.input<typeof startDateBodySchema>;
export type WaitingOnBody = z.input<typeof waitingOnBodySchema>;
export type PriorityBody = z.input<typeof priorityBodySchema>;
export type EstimateBody = z.input<typeof estimateBodySchema>;
export type AssigneeBody = z.input<typeof assigneeBodySchema>;
export type LabelBody = z.input<typeof labelBodySchema>;
