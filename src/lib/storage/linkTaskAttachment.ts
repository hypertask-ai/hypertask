import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { persistAttachmentRows } from "@/lib/mcp/attachments/persistBatch";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getHypertasksStoragePublicUrl } from "@/lib/storage/hypertasksS3";
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

export async function linkTaskAttachment(
  taskId: number,
  userId: number,
  receipt: TaskAttachmentLinkReceipt,
) {
  if (
    !receipt.key.startsWith(`${TASK_ATTACHMENT_PREFIX}/`) ||
    receipt.key.includes("..")
  ) {
    throw new TaskAttachmentLinkError("Invalid attachment receipt", 400);
  }

  return prisma.$transaction(
    async (tx) => {
      // The task row lock keeps a move/delete from changing authorization between
      // the access check and the attachment write. It also serializes lost-response
      // retries so persistAttachmentRows can return the first committed row.
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
          description_: { select: { id: true } },
        },
      });
      if (!task?.description_?.id) {
        throw new TaskAttachmentLinkError("Task not found or access denied", 404);
      }

      const fileSource = getHypertasksStoragePublicUrl(receipt.key);
      await persistAttachmentRows(
        tx,
        [
          {
            filename: receipt.fileName,
            contentType: receipt.contentType,
            fileSize: receipt.fileSize,
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
          descriptionId: true,
          taskId: true,
        },
      });
    },
    { timeout: 10_000 },
  );
}
