import { assertFileSizeForProject, isPlanLimitsEnabled, isPlanLimitReachedError } from "@/lib/planLimits";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { persistAttachmentRows } from "@/lib/mcp/attachments/persistBatch";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  getHypertasksS3Client,
  getHypertasksStoragePublicUrl,
  HYPERTASKS_S3_BUCKET,
} from "@/lib/storage/hypertasksS3";
import { TASK_ATTACHMENT_PREFIX } from "@/lib/storage/uploadTaskAttachmentToS3";
import type { TaskAttachmentLinkReceipt } from "@/lib/storage/uploadGrant";

export class TaskAttachmentLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TaskAttachmentLinkError";
  }
}

export async function lockAttachmentReceipt(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${5993}))::text AS lock_result`,
  );
}

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const storageError = error as { code?: unknown; statusCode?: unknown };
  return (
    storageError.statusCode === 404 ||
    storageError.code === "NotFound" ||
    storageError.code === "NoSuchKey"
  );
}

export async function linkTaskAttachment(
  taskId: number,
  userId: number,
  receipt: TaskAttachmentLinkReceipt,
) {
  if (receipt.userId !== userId) {
    throw new TaskAttachmentLinkError("This upload cannot be linked", 403);
  }
  if (
    !receipt.key.startsWith(`${TASK_ATTACHMENT_PREFIX}/`) ||
    receipt.key.includes("..")
  ) {
    throw new TaskAttachmentLinkError("Invalid attachment receipt", 400);
  }

  const planLimitsEnabled = await isPlanLimitsEnabled(userId);
  return prisma.$transaction(
    async (tx) => {
      await lockAttachmentReceipt(tx, receipt.key);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`,
      );
      const task = await tx.task.findFirst({
        where: {
          id: taskId,
          project: taskWriteAccessWhere(userId),
        },
        select: {
          id: true,
          projectId: true,
          description_: { select: { id: true } },
        },
      });
      if (!task?.description_?.id) {
        throw new TaskAttachmentLinkError("Task not found or access denied", 404);
      }

      const fileSource = getHypertasksStoragePublicUrl(receipt.key);
      const existing = await tx.attachment.findFirst({
        where: planLimitsEnabled ? {
          OR: [
            { fileSource },
            { fileSource: { endsWith: `/${receipt.key}` } },
            { fileSource: { contains: `/${receipt.key}?` } },
          ],
        } : { fileSource },
        select: {
          id: true,
          createdAt: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          fileSource: true,
          commentId: true,
          descriptionId: true,
          taskId: true,
        },
      });
      if (existing) {
        if (
          existing.taskId === taskId &&
          existing.descriptionId === task.description_.id &&
          existing.commentId === null
        ) {
          return existing;
        }
        throw new TaskAttachmentLinkError("This upload is already linked", 409);
      }

      let measuredBytes: number | undefined;
      try {
        const head = await getHypertasksS3Client()
          .headObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: receipt.key })
          .promise();
        if (planLimitsEnabled) {
          if (head.ContentLength == null) {
            throw new TaskAttachmentLinkError("That upload could not be verified", 409);
          }
          measuredBytes = head.ContentLength;
          await assertFileSizeForProject(task.projectId, measuredBytes, {
            actorUserId: userId, entryPoint: "tasks.uploadFinalize.link",
          });
        }
      } catch (error) {
        if (isPlanLimitReachedError(error)) {
          try {
            await getHypertasksS3Client()
              .deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: receipt.key })
              .promise();
          } catch (cleanupError) {
            console.error("[plan-limit] staged attachment cleanup failed", cleanupError);
          }
          throw error;
        }
        if (isStorageNotFound(error)) {
          throw new TaskAttachmentLinkError("This upload is no longer available", 409);
        }
        throw error;
      }

      await persistAttachmentRows(
        tx,
        [
          {
            filename: receipt.fileName,
            contentType: receipt.contentType,
            fileSize: measuredBytes ?? receipt.fileSize,
            url: fileSource,
          },
        ],
        {
          taskId,
          commentId: null,
          descriptionId: task.description_.id,
        },
      );

      return tx.attachment.findFirstOrThrow({
        where: {
          taskId,
          descriptionId: task.description_.id,
          commentId: null,
          fileSource,
        },
        select: {
          id: true,
          createdAt: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          fileSource: true,
          commentId: true,
          descriptionId: true,
          taskId: true,
        },
      });
    },
    { timeout: 10_000 },
  );
}

export async function discardTaskAttachment(
  userId: number,
  receipt: TaskAttachmentLinkReceipt,
): Promise<boolean> {
  if (receipt.userId !== userId) {
    throw new TaskAttachmentLinkError("This upload cannot be discarded", 403);
  }
  if (
    !receipt.key.startsWith(`${TASK_ATTACHMENT_PREFIX}/`) ||
    receipt.key.includes("..")
  ) {
    throw new TaskAttachmentLinkError("Invalid attachment receipt", 400);
  }

  return discardUnlinkedTaskAttachment(receipt.key);
}

export async function discardUnlinkedTaskAttachment(key: string, matchStorageAliases = false): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      await lockAttachmentReceipt(tx, key);
      const linked = await tx.attachment.findFirst({
        where: matchStorageAliases ? {
          OR: [
            { fileSource: getHypertasksStoragePublicUrl(key) },
            { fileSource: { endsWith: `/${key}` } },
            { fileSource: { contains: `/${key}?` } },
          ],
        } : { fileSource: getHypertasksStoragePublicUrl(key) },
        select: { id: true },
      });
      if (linked) return false;

      try {
        await getHypertasksS3Client()
          .deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
          .promise();
      } catch {
        throw new TaskAttachmentLinkError("Could not discard attachment", 502);
      }
      return true;
    },
    { timeout: 10_000 },
  );
}
