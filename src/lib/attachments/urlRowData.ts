import type { IUrl } from '@/models/model';

export function urlRowData(url: IUrl, overrides: { taskId?: number; commentId?: number | null } = {}) {
  return {
    urlString: url.urlString ?? '',
    title: url.title,
    commentId: overrides.commentId !== undefined ? overrides.commentId : url.commentId,
    TaskId: overrides.taskId !== undefined ? overrides.taskId : url.TaskId,
    Attachment: url.Attachment === undefined ? undefined : Boolean(url.Attachment),
  };
}
