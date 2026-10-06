import { z } from "zod";

const id = z.number().int().positive();
export const descriptionVersionsPathSchema = z.object({ taskId: id });
export const descriptionVersionsResponseSchema = z.looseObject({
  current: z.looseObject({ contentText: z.string() }),
  hasMore: z.boolean(),
  versions: z.array(z.looseObject({
    id,
    version: z.number().int(),
    contentText: z.string(),
    authorId: id.nullable(),
    agentId: z.string().nullable(),
    createdAt: z.string(),
    actor: z.looseObject({ displayName: z.string(), type: z.enum(["agent", "user"]) }),
  })),
});

export const taskCycleQuerySchema = z.object({
  taskId: id.max(2_147_483_647),
  query: z.string().optional(),
  cursor: id.max(2_147_483_647).optional(),
});
export const cycleResponseSchema = z.looseObject({
  id,
  projectId: id,
  number: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  rolledOverAt: z.string().nullable(),
});
export const taskCycleResponseSchema = z.looseObject({
  enabled: z.boolean(),
  assignedCycle: cycleResponseSchema.nullable(),
  cycles: z.array(cycleResponseSchema.extend({ assignable: z.boolean() })),
  nextCursor: id.nullable(),
});

// These are wire projections, not the richer, hydrated ITask/IProject models.
export const taskRelationSchema = z.looseObject({
  id,
  uniqueIndex: z.number().int(),
  ticketNumber: z.string().nullable(),
  title: z.string(),
  status: z.enum(["Normal", "Archive", "Deleted"]),
  projectId: id,
  sectionId: id.nullable(),
});
export const compactTaskRelationsBodySchema = z.object({ projectId: id });
export const compactTaskRelationsResponseSchema = z.array(z.looseObject({
  id,
  title: z.string(),
  uniqueIndex: z.number().int(),
  ranking: z.string(),
  userId: id,
  projectId: id,
  section: z.string(),
  sectionId: id.nullable(),
  createdAt: z.string(),
  sectionChangedAt: z.string(),
  lastCommentAt: z.string().nullable(),
  assignees: z.array(z.looseObject({ user: z.looseObject({ id }).nullable() })),
  comments: z.array(z.looseObject({ id, notifications: z.array(z.looseObject({ id })) })),
  subTasks: z.array(taskRelationSchema.extend({ createdAt: z.string() })),
  parentTask: taskRelationSchema.extend({ subTasks: z.array(taskRelationSchema) }).nullable(),
}));

export const boardDetailBodySchema = z.object({ projectId: id, userId: id });
export const boardDetailResponseSchema = z.looseObject({
  project: z.looseObject({ id, title: z.string().nullable(), sections: z.array(z.string()) }),
  tasks: z.array(z.looseObject({
    id,
    title: z.string(),
    uniqueIndex: z.number().int(),
    projectId: id,
    section: z.string(),
    subTasks: z.array(taskRelationSchema),
    parentTask: z.looseObject({ id, sectionId: id.nullable(), ticketNumber: z.string().nullable(), title: z.string() }).nullable(),
  })),
  allViews: z.array(z.looseObject({ id: z.string() })),
});
export const boardReadErrorSchema = z.union([
  z.looseObject({ error: z.string(), code: z.string().optional() }),
  z.looseObject({ message: z.string() }),
]);

export type DescriptionVersionsResponse = z.output<typeof descriptionVersionsResponseSchema>;
export type TaskCycleQuery = z.input<typeof taskCycleQuerySchema>;
export type TaskCycleResponse = z.output<typeof taskCycleResponseSchema>;
export type BoardDetailBody = z.input<typeof boardDetailBodySchema>;
