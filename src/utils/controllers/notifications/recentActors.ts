import type { NotificationType } from "@prisma/client";

export type InboxActorActivity = {
  taskId: number | null;
  type: NotificationType;
  fromAgentId: string | null;
  fromUserId: number | null;
  _max: { createdAt: Date | null };
};

export type InboxActorActivityRow = {
  taskId: number | null;
  type: NotificationType;
  fromAgentId: string | null;
  fromUserId: number | null;
  createdAt: Date;
};

export type InboxActorProfile = {
  displayName: string | null;
  photoURL: string | null;
};

export type InboxRecentActor = {
  displayName: string;
  photoURL: string | null;
};

/**
 * Adapt rows already reduced by the database to the shape used by the actor
 * builder. The query returns one newest row per task/type/actor pair, so this only
 * wraps the timestamp and does not scan or collapse notification history.
 */
export const normalizeInboxActorActivityRows = (
  rows: readonly InboxActorActivityRow[],
): InboxActorActivity[] => {
  return rows.map((row) => ({
    taskId: row.taskId,
    type: row.type,
    fromAgentId: row.fromAgentId,
    fromUserId: row.fromUserId,
    _max: { createdAt: row.createdAt },
  }));
};

/**
 * Keep the two newest distinct actors for each task from grouped notification
 * activity. The read query collapses each task/type/actor pair in the database;
 * `_max.createdAt` preserves the newest-actor order.
 */
export const buildRecentInboxActors = ({
  activity,
  agentsById,
  usersById,
}: {
  activity: InboxActorActivity[];
  agentsById: Map<string, InboxActorProfile>;
  usersById: Map<number, InboxActorProfile>;
}): Record<number, InboxRecentActor[]> => {
  const recentActorsByTaskId: Record<number, InboxRecentActor[]> = {};
  const actorKeysByTaskId: Record<number, Set<string>> = {};
  const newestFirst = activity
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const rightTime = right.row._max.createdAt?.getTime() ?? 0;
      const leftTime = left.row._max.createdAt?.getTime() ?? 0;
      return rightTime - leftTime || left.index - right.index;
    });

  for (const { row } of newestFirst) {
    if (row.taskId == null) continue;
    recentActorsByTaskId[row.taskId] ??= [];
    actorKeysByTaskId[row.taskId] ??= new Set();
    if (recentActorsByTaskId[row.taskId].length >= 2) continue;

    const agentProfile = row.fromAgentId
      ? agentsById.get(row.fromAgentId)
      : null;
    const userProfile = row.fromUserId != null
      ? usersById.get(row.fromUserId)
      : null;
    // Agent-authored rows routinely retain the token owner's user id too. If
    // the agent is deleted between the grouped activity read and profile read,
    // preserve the old relation-query fallback to that human profile.
    const profile = agentProfile ?? userProfile;
    const actorKey = agentProfile && row.fromAgentId
      ? `a:${row.fromAgentId}`
      : userProfile && row.fromUserId != null
        ? `u:${row.fromUserId}`
        : null;
    if (!profile || !actorKey || actorKeysByTaskId[row.taskId].has(actorKey)) {
      continue;
    }

    actorKeysByTaskId[row.taskId].add(actorKey);
    recentActorsByTaskId[row.taskId].push({
      displayName: profile.displayName ?? "",
      photoURL: profile.photoURL,
    });
  }

  return recentActorsByTaskId;
};
