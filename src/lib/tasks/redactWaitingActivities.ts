import prisma from "@/lib/prisma";
import {
  collectWaitingTargets, concealedWaitingNames, hiddenWaitingAgents, redactWaitingOnActivity,
  replaceConcealedNames, type WaitingAgentRecord,
} from "@/lib/tasks/waitingAgentPrivacy";

const accepted = (projectId: number) => ({ projectId, status: "Accepted" as const });

async function loadWaitingAgents(comments: readonly { activity?: unknown }[], projectId: number, sharedPrivate: boolean) {
  const targets = collectWaitingTargets(comments);
  if (targets.ids.length === 0 && targets.names.length === 0) return [];
  const ids = targets.ids.length ? [{ id: { in: targets.ids } }] : [];
  const names = targets.names.length ? [{
    displayName: { in: targets.names },
    ...(sharedPrivate ? {} : { visibility: "PRIVATE" as const }),
    members: { some: accepted(projectId) },
  }] : [];
  return prisma.agent.findMany({
    where: sharedPrivate ? { visibility: "PRIVATE", OR: [...ids, ...names] } : { OR: [...ids, ...names] },
    select: {
      id: true, displayName: true, photoURL: true, userId: true, visibility: true,
      members: { where: accepted(projectId), select: { projectId: true } },
    },
  }) as Promise<WaitingAgentRecord[]>;
}

function applyRedaction<T extends { activity?: unknown }>(
  comments: T[], hiddenIds: ReadonlySet<string>, hiddenNames: ReadonlySet<string>, viewerUserId: number,
) {
  return comments.map((comment) => ({
    ...comment,
    activity: redactWaitingOnActivity(comment.activity, hiddenIds, hiddenNames, viewerUserId) as T["activity"],
  }));
}

export async function withPublicWaitingActivities<T extends { activity?: unknown }>(comments: T[], userId: number, projectId: number) {
  const targets = collectWaitingTargets(comments);
  if (targets.ids.length === 0 && targets.names.length === 0) return comments;
  const hidden = hiddenWaitingAgents(await loadWaitingAgents(comments, projectId, false), userId, projectId);
  return applyRedaction(comments, hidden.hiddenIds, hidden.hiddenNames, userId);
}

export async function concealedWaitingDisplayNames(comments: readonly { activity?: unknown }[], userId: number, projectId: number) {
  const agents = await loadWaitingAgents(comments, projectId, false);
  const hidden = agents.length === 0 ? { hiddenIds: new Set<string>(), hiddenNames: new Set<string>() } : hiddenWaitingAgents(agents, userId, projectId);
  return concealedWaitingNames(comments, hidden.hiddenIds, hidden.hiddenNames, userId);
}

export async function scrubStoredTaskSummary(content: string | null | undefined, taskId: number, userId: number, projectId: number) {
  if (!content) return content;
  const comments = await prisma.comment.findMany({
    where: { taskId, activity: { path: ["type"], equals: "TaskWaitingOn" } },
    select: { activity: true },
  });
  const names = await concealedWaitingDisplayNames(comments, userId, projectId);
  return names.length === 0 ? content : replaceConcealedNames(content, names);
}

export async function redactSharedPrivateWaitingActivities<T extends { activity?: unknown }>(comments: T[], projectId: number) {
  const targets = collectWaitingTargets(comments);
  if (targets.ids.length === 0 && targets.names.length === 0) return comments;
  const agents = await loadWaitingAgents(comments, projectId, true);
  return applyRedaction(
    comments,
    new Set(agents.map((agent) => agent.id)),
    new Set(agents.flatMap((agent) => (agent.displayName ? [agent.displayName] : []))),
    0,
  );
}
