import { z } from "zod";

const id = z.number().int().positive();
export const notificationSeenQuerySchema = z.object({ notificationId: id, seen: z.union([z.literal(0), z.literal(1)]) });
export const notificationArchiveQuerySchema = z.object({
  id: z.string(),
  taskId: id.nullable(),
  userId: id,
  type: z.string(),
  tutorial: z.literal(1).optional(),
  intent: z.literal("archive").optional(),
});
export const notificationUnarchiveBodySchema = z.object({ notificationId: z.union([id, z.string()]) });
export const notificationBulkArchiveBodySchema = z.object({
  notificationIds: z.array(z.object({ notificationId: id, taskId: id.nullable(), userId: id })),
  status: z.literal("Archive"),
});
export const notificationResponseSchema = z.looseObject({
  id,
  type: z.enum(["Assigned", "Comment", "Invited", "Reacted", "TaskArchived", "TaskMoved", "TaskDueDate", "AddedToFollowerInTask", "TaskReminder", "TaskMovedToInbox", "TaskUpdateDescription", "TaskOverdue", "Mentioned", "AgentMessage", "AgentBoardAccessRequest"]),
  userId: id,
  taskId: id.nullable(),
  projectId: id.nullable(),
  status: z.enum(["Normal", "Archive", "Deleted"]),
  seen: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export const notificationBulkArchiveResponseSchema = z.looseObject({
  message: z.literal("Notifications processed successfully"),
  archivedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
});
export const notificationWriteErrorSchema = z.looseObject({ message: z.string() });
export const notificationUnarchiveErrorSchema = z.looseObject({});

export type NotificationSeenQuery = z.input<typeof notificationSeenQuerySchema>;
export type NotificationArchiveQuery = z.input<typeof notificationArchiveQuerySchema>;
export type NotificationUnarchiveBody = z.input<typeof notificationUnarchiveBodySchema>;
export type NotificationBulkArchiveBody = z.input<typeof notificationBulkArchiveBodySchema>;
