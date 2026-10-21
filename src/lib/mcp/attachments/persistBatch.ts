import { inlineAgentImages } from "@/lib/media/inlineAgentImages";
import type { Prisma } from '@prisma/client';
import type {
  StoredAttachmentResult,
  UploadedAttachmentSpec,
} from './storeBatch';

export type AttachmentPersistenceClient = Pick<
  Prisma.TransactionClient,
  'attachment' | 'description' | 'comment'
>;

export async function persistAttachmentRows(
  db: AttachmentPersistenceClient,
  uploads: UploadedAttachmentSpec[],
  target: { taskId: number; commentId: number | null; descriptionId: string | null; inlineImages?: boolean }
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

  if (target.inlineImages) {
    const attachments = uploads.map((file) => ({ url: file.url, fileName: file.filename, mimeType: file.contentType }));
    if (target.commentId !== null) {
      const comment = await db.comment.findUniqueOrThrow({ where: { id: target.commentId }, select: { text: true } });
      const text = inlineAgentImages(comment.text, { enabled: true, attachments });
      if (text !== comment.text) {
        const result = await db.comment.updateMany({ where: { id: target.commentId, text: comment.text }, data: { text } });
        if (result.count !== 1) throw new Error("Comment changed while embedding images; retry the upload");
      }
    } else if (target.descriptionId !== null) {
      const description = await db.description.findUniqueOrThrow({ where: { id: target.descriptionId }, select: { content: true } });
      const content = inlineAgentImages(description.content ?? "", { enabled: true, attachments });
      if (content !== description.content) {
        const result = await db.description.updateMany({ where: { id: target.descriptionId, content: description.content }, data: { content } });
        if (result.count !== 1) throw new Error("Description changed while embedding images; retry the upload");
      }
    }
  }
  return stored;
}
