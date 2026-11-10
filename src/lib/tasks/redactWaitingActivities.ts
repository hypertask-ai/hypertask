import prisma from "@/lib/prisma";
import {
  collectWaitingTargets,
  hiddenWaitingAgents,
  redactWaitingOnActivity,
  type WaitingAgentRecord,
} from "@/lib/tasks/waitingAgentPrivacy";

const agentSelect = {
  id: true,
  displayName: true,
  photoURL: true,
  userId: true,
  visibility: true,
} as const;

export async function withPublicWaitingActivities<T extends { activity?: unknown }>(
  comments: T[],
  userId: number,
  projectId: number,
): Promise<T[]> {
  const { ids, names } = collectWaitingTargets(comments);
  if (ids.length === 0 && names.length === 0) return comments;
  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(names.length
          ? [{
              displayName: { in: names },
              visibility: "PRIVATE" as const,
              members: { some: { projectId, status: "Accepted" as const } },
            }]
          : []),
      ],
    },
    select: {
      ...agentSelect,
      members: {
        where: { projectId, status: "Accepted" },
        select: { projectId: true },
      },
    },
  });
  const { hiddenIds, hiddenNames } = hiddenWaitingAgents(
    agents as WaitingAgentRecord[],
    userId,
    projectId,
  );
  return comments.map((comment) => ({
    ...comment,
    activity: redactWaitingOnActivity(comment.activity, hiddenIds, hiddenNames) as T["activity"],
  }));
}

export async function redactSharedPrivateWaitingActivities<T extends { activity?: unknown }>(
  comments: T[],
  projectId: number,
): Promise<T[]> {
  const { ids, names } = collectWaitingTargets(comments);
  if (ids.length === 0 && names.length === 0) return comments;
  const agents = await prisma.agent.findMany({
    where: {
      visibility: "PRIVATE",
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(names.length
          ? [{
              displayName: { in: names },
              members: { some: { projectId, status: "Accepted" as const } },
            }]
          : []),
      ],
    },
    select: { id: true, displayName: true, visibility: true },
  });
  const hiddenIds = new Set(agents.map((agent) => agent.id));
  const hiddenNames = new Set(
    agents.flatMap((agent) => (agent.displayName ? [agent.displayName] : [])),
  );
  return comments.map((comment) => ({
    ...comment,
    activity: redactWaitingOnActivity(comment.activity, hiddenIds, hiddenNames) as T["activity"],
  }));
}
