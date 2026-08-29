import type { IUrl } from '@/models/model';

/**
 * `IUrl` is the transport shape the editor sends. It carries fields that are not
 * columns on the `Url` model (`attachmentType`, `fileSize`, `projectId`,
 * `ticketNumber`), which the attachment row consumes instead. Spreading it into
 * a Prisma write fails at runtime with an unknown argument, so every URL write
 * goes through this allowlist.
 */
export function urlRowData(url: IUrl, overrides: { taskId?: number; commentId?: number | null } = {}) {
  return {
    urlString: url.urlString ?? '',
    title: url.title,
    commentId: overrides.commentId !== undefined ? overrides.commentId : url.commentId,
    TaskId: overrides.taskId !== undefined ? overrides.taskId : url.TaskId,
    // Left undefined when the payload omits it, so an update never silently
    // clears the flag on a row that is already marked as an attachment.
    Attachment: url.Attachment === undefined ? undefined : Boolean(url.Attachment),
  };
}
