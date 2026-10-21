import type { NotificationType } from "@prisma/client";

export const verbByType: Record<NotificationType, string> = {
  Comment: "commented",
  Reacted: "reacted to a comment",
  Mentioned: "mentioned you",
  AddedToFollowerInTask: "added you as a follower",
  Assigned: "assigned this to you",
  TaskMoved: "moved this task",
  TaskArchived: "archived this task",
  TaskMovedToInbox: "moved this task to the inbox",
  TaskUpdateDescription: "updated the description",
  TaskDueDate: "changed the due date",
  TaskOverdue: "flagged this as overdue",
  TaskReminder: "set a reminder",
  Invited: "invited you",
  AgentMessage: "sent you a message",
};

const specificity: Partial<Record<NotificationType, number>> = {
  Mentioned: 3,
  AddedToFollowerInTask: 2,
  Comment: 1,
};

export function dedupePerComment<
  T extends { type: NotificationType; commentId: number | null },
>(notifications: T[]): T[] {
  const rank = (type: NotificationType) => specificity[type] ?? 0;

  const bestByComment = new Map<number, T>();
  const passthrough: T[] = [];

  for (const notification of notifications) {
    if (notification.commentId === null) {
      passthrough.push(notification);
      continue;
    }
    const current = bestByComment.get(notification.commentId);
    if (!current || rank(notification.type) > rank(current.type)) {
      bestByComment.set(notification.commentId, notification);
    }
  }

  return [...passthrough, ...bestByComment.values()];
}
