import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  assertUploadAllowedForProject,
  isPlanLimitsEnabled,
  isPlanLimitReachedError,
  type PlanLimitContext,
} from "@/lib/planLimits";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getHypertasksS3Client, HYPERTASKS_S3_BUCKET, parseHypertasksStorageKeyFromUrl } from "@/lib/storage/hypertasksS3";
import { getHypertasksObjectSize } from "@/lib/storage/uploadTaskAttachmentToS3";
import {
  discardUnlinkedTaskAttachment,
  lockAttachmentReceipt,
  TaskAttachmentLinkError,
} from "@/lib/storage/linkTaskAttachment";

export async function verifyTaskAttachmentLinks(
  db: Pick<Prisma.TransactionClient, "task" | "comment" | "attachment" | "$queryRaw">,
  sources: string[],
  target: { taskId?: number; commentId?: number; projectId?: number; newlyUploadedSources?: readonly string[]; verifyExisting?: boolean },
  ctx: PlanLimitContext,
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (sources.length === 0 || !await isPlanLimitsEnabled(ctx.actorUserId)) return sizes;
  const objects = sources.flatMap((source) => {
    const key = parseHypertasksStorageKeyFromUrl(source);
    return key && !key.includes("..")
      ? [{ source, key }]
      : [];
  });
  if (objects.length === 0) return sizes;

  const inTransaction = db !== prisma;
  if (inTransaction) {
    for (const key of [...new Set(objects.map((object) => object.key))].sort()) {
      await lockAttachmentReceipt(db, key);
    }
  }
  let projectId = target.projectId;
  let taskId = target.taskId;
  if (target.commentId !== undefined) {
    const comment = await db.comment.findFirst({
      where: {
        id: target.commentId,
        ...(ctx.actorUserId === null ? {} : {
          task: { project: taskWriteAccessWhere(ctx.actorUserId, ctx.agentId) },
        }),
      },
      select: { taskId: true },
    });
    if (!comment) throw new TaskAttachmentLinkError("Comment not found or access denied", 404);
    taskId = comment.taskId;
  }
  if (taskId !== undefined) {
    if (inTransaction) {
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`);
    }
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        ...(ctx.actorUserId === null ? {} : {
          project: taskWriteAccessWhere(ctx.actorUserId, ctx.agentId),
        }),
      },
      select: { projectId: true },
    });
    if (!task) throw new TaskAttachmentLinkError("Task not found or access denied", 404);
    projectId = task.projectId;
  }
  if (projectId === undefined) throw new TaskAttachmentLinkError("Attachment destination is missing", 400);

  for (const { source, key } of objects) {
    const sourceWhere = {
      OR: [
        { fileSource: source },
        { fileSource: { endsWith: `/${key}` } },
        { fileSource: { contains: `/${key}?` } },
      ],
    };
    if (!target.verifyExisting && taskId !== undefined && await db.attachment.findFirst({
      where: {
        ...sourceWhere,
        taskId,
        ...(target.commentId !== undefined
          ? { commentId: target.commentId }
          : { commentId: null, descriptionId: { not: null } }),
      },
      select: { id: true },
    })) continue;
    const existing = await db.attachment.findFirst({
      where: sourceWhere,
      select: { id: true },
    });
    const bytes = await getHypertasksObjectSize(key);
    if (bytes === null) throw new TaskAttachmentLinkError("That upload could not be verified", 409);
    try {
      await assertUploadAllowedForProject(projectId, bytes, ctx, { alreadyStored: Boolean(existing) });
    } catch (error) {
      if (isPlanLimitReachedError(error) && !existing && target.newlyUploadedSources?.includes(source)) {
        try {
          if (inTransaction) {
            await getHypertasksS3Client()
              .deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
              .promise();
          } else {
            await discardUnlinkedTaskAttachment(key, true);
          }
        } catch (cleanupError) {
          console.error("[plan-limit] staged attachment cleanup failed", cleanupError);
        }
      }
      throw error;
    }
    sizes.set(source, bytes);
  }
  return sizes;
}
