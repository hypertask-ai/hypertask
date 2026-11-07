export function attachmentDownloadHint(taskId: number, attachmentId: number) {
  return `GET /api/mcp/tasks/attachments?task_id=${taskId}&attachment_id=${attachmentId} with the same bearer token. fileSource is not an agent download.`
}

export function withAttachmentDownloadHints<T extends { id: number; attachments?: Array<{ id: number }> }>(
  task: T,
  enabled: boolean,
): T {
  if (!enabled || !task.attachments?.length) return task
  return {
    ...task,
    attachments: task.attachments.map((attachment) => ({
      ...attachment,
      download: attachmentDownloadHint(task.id, attachment.id),
    })),
  }
}
