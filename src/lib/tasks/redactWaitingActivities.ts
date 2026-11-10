import prisma from "@/lib/prisma";
import {
  collectWaitingTargets,
  concealedWaitingNames,
  hiddenWaitingAgents,
  redactWaitingOnActivity,
  replaceConcealedNames,
  type WaitingAgentRecord,
} from "@/lib/tasks/waitingAgentPrivacy";

const agentSelect = { id: true, displayName: true, photoURL: true, userId: true, visibility: true } as const;

function applyRedaction<T extends { activity?: unknown }>(
  comments: T[],
  hiddenIds: ReadonlySet<string>,
  hiddenNames: ReadonlySet<string>,
  viewerUserId: number,
) {
  return comments.map((comment) => ({
    ...comment,
    activity: redactWaitingOnActivity(comment.activity, hiddenIds, hiddenNames, viewerUserId) as T["activity"],
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
        ...(names.length ? [{ displayName: { in: names }, visibility: "PRIVATE" as const, members: { some: { projectId, status: "Accepted" as const } } }] : []),
      ],
    },
    select: {
      ...agentSelect,
      members: { where: { projectId, status: "Accepted" as const }, select: { projectId: true } },
    },
  });
  const hidden = hiddenWaitingAgents(agents as WaitingAgentRecord[], userId, projectId);
  return applyRedaction(comments, hidden.hiddenIds, hidden.hiddenNames, userId);
}

export async function concealedWaitingDisplayNames(
  comments: readonly { activity?: unknown }[],
  userId: number,
  projectId: number,
): Promise<string[]> {
  const { ids, names } = collectWaitingTargets(comments);
  if (ids.length === 0 && names.length === 0) {
    return concealedWaitingNames(comments, new Set(), new Set(), userId);
  }
  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(names.length ? [{ displayName: { in: names }, visibility: "PRIVATE" as const, members: { some: { projectId, status: "Accepted" as const } } }] : []),
      ],
    },
    select: {
      ...agentSelect,
      members: { where: { projectId, status: "Accepted" as const }, select: { projectId: true } },
    },
  });
  const hidden = hiddenWaitingAgents(agents as WaitingAgentRecord[], userId, projectId);
  return concealedWaitingNames(comments, hidden.hiddenIds, hidden.hiddenNames, userId);
}

export async function scrubStoredTaskSummary(
  content: string | null | undefined,
  taskId: number,
  userId: number,
  projectId: number,
): Promise<string | null | undefined> {
  if (!content) return content;
  const comments = await prisma.comment.findMany({
    where: { taskId, activity: { path: ["type"], equals: "TaskWaitingOn" } },
    select: { activity: true },
  });
  const names = await concealedWaitingDisplayNames(comments, userId, projectId);
  return names.length === 0 ? content : replaceConcealedNames(content, names);
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
        ...(names.length ? [{ displayName: { in: names }, members: { some: { projectId, status: "Accepted" as const } } }] : []),
      ],
    },
    select: { id: true, displayName: true },
  });
  return applyRedaction(
    comments,
    new Set(agents.map((agent) => agent.id)),
    new Set(agents.flatMap((agent) => (agent.displayName ? [agent.displayName] : []))),
    0,
  );
}
