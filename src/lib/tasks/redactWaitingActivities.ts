import prisma from "@/lib/prisma";
import {
  collectWaitingTargets,
  hiddenWaitingAgents,
  redactWaitingOnActivity,
  type WaitingAgentRecord,
} from "@/lib/tasks/waitingAgentPrivacy";

const agentSelect = { id: true, displayName: true, photoURL: true, userId: true, visibility: true } as const;

function applyRedaction<T extends { activity?: unknown }>(
  comments: T[],
  hiddenIds: ReadonlySet<string>,
  hiddenNames: ReadonlySet<string>,
) {
  return comments.map((comment) => ({
    ...comment,
    activity: redactWaitingOnActivity(comment.activity, hiddenIds, hiddenNames) as T["activity"],
  }));
}

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
        ...(names.length ? [{ displayName: { in: names }, visibility: "PRIVATE" as const }] : []),
      ],
    },
    select: {
      ...agentSelect,
      members: { where: { projectId, status: "Accepted" as const }, select: { projectId: true } },
    },
  });
  const hidden = hiddenWaitingAgents(agents as WaitingAgentRecord[], userId, projectId);
  return applyRedaction(comments, hidden.hiddenIds, hidden.hiddenNames);
}

export async function redactSharedPrivateWaitingActivities<T extends { activity?: unknown }>(
  comments: T[],
  projectId: number,
): Promise<T[]> {
  const { ids, names } = collectWaitingTargets(comments);
  if (!Number.isInteger(projectId)) return comments;
  if (ids.length === 0 && names.length === 0) return comments;
  const agents = await prisma.agent.findMany({
    where: {
      visibility: "PRIVATE",
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(names.length ? [{ displayName: { in: names } }] : []),
      ],
    },
    select: { id: true, displayName: true },
  });
  return applyRedaction(
    comments,
    new Set(agents.map((agent) => agent.id)),
    new Set(agents.flatMap((agent) => (agent.displayName ? [agent.displayName] : []))),
  );
}
