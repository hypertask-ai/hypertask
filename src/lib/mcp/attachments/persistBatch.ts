import type { Prisma } from '@prisma/client';
import type {
  StoredAttachmentResult,
  UploadedAttachmentSpec,
} from './storeBatch';

export type AttachmentPersistenceClient = Pick<
  Prisma.TransactionClient,
  'attachment'
>;

/**
 * A deterministic fileSource is the persisted retry identity. Sequential retries
 * return the committed row rather than creating another visible attachment.
 */
export async function persistAttachmentRows(
  db: AttachmentPersistenceClient,
  uploads: UploadedAttachmentSpec[],
  target: { taskId: number; commentId: number | null; descriptionId: string | null }
): Promise<StoredAttachmentResult[]> {
  const stored: StoredAttachmentResult[] = [];

  for (const file of uploads) {
    const where = {
      taskId: target.taskId,
      commentId: target.commentId,
      descriptionId: target.descriptionId,
      fileSource: file.url,
    };
    const existing = await db.attachment.findFirst({
      where,
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSource: true,
      },
    });
    if (existing) {
      stored.push(existing);
      continue;
    }

    stored.push(
      await db.attachment.create({
        data: {
          fileType: file.contentType,
          fileSource: file.url,
          fileName: file.filename,
          fileSize: String(file.fileSize),
          taskId: target.taskId,
          ...(target.commentId !== null ? { commentId: target.commentId } : {}),
          ...(target.descriptionId !== null
            ? { descriptionId: target.descriptionId }
            : {}),
        },
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSource: true,
        },
      })
    );
  }

  return stored;
}
