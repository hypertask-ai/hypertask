import type { NotificationType } from "@prisma/client";

export function agentIdsRequiringImportantPermission(
  ...rowGroups: ReadonlyArray<ReadonlyArray<{ fromAgentId: string | null }>>
): string[] {
  return Array.from(
    new Set(
      rowGroups.flatMap((rows) =>
        rows.flatMap((row) => (row.fromAgentId ? [row.fromAgentId] : [])),
      ),
    ),
  );
}

/**
 * Direct replies bypass ordinary inbox filtering only when the sending agent
 * is allowed to post to Important.
 */
export function directReplyTypesByTask(
  rows: ReadonlyArray<{
    taskId: number | null;
    type: NotificationType;
    fromAgentId: string | null;
  }>,
  agentsWithoutImportantPermission: ReadonlySet<string>,
): Record<number, NotificationType[]> {
  const result: Record<number, NotificationType[]> = {};
  for (const row of rows) {
    if (
      row.taskId === null ||
      (row.fromAgentId !== null &&
        agentsWithoutImportantPermission.has(row.fromAgentId))
    ) {
      continue;
    }
    result[row.taskId] ??= [];
    if (!result[row.taskId].includes(row.type)) {
      result[row.taskId].push(row.type);
    }
  }
  return result;
}

export function directReplyStateForNotification(
  notification: {
    taskId: number | null;
    type: NotificationType;
    fromAgentId: string | null;
    directReply: boolean;
  },
  typesByTask: Readonly<Record<number, NotificationType[]>>,
  agentsWithoutImportantPermission: ReadonlySet<string>,
): { directReply: boolean; directReplyTypes: NotificationType[] } {
  const notificationMayPostToImportant =
    notification.fromAgentId === null ||
    !agentsWithoutImportantPermission.has(notification.fromAgentId);
  let directReplyTypes: NotificationType[];
  if (!notificationMayPostToImportant) {
    directReplyTypes = [];
  } else if (notification.taskId === null) {
    directReplyTypes =
      notification.directReply ? [notification.type] : [];
  } else {
    directReplyTypes = [...(typesByTask[notification.taskId] ?? [])];
  }

  if (
    notification.taskId !== null &&
    notification.directReply &&
    notificationMayPostToImportant &&
    !directReplyTypes.includes(notification.type)
  ) {
    directReplyTypes.push(notification.type);
  }

  return {
    directReplyTypes,
    directReply: directReplyTypes.length > 0,
  };
}
