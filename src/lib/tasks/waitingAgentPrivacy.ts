import { PRIVATE_AGENT_DISPLAY_NAME } from "@/lib/agents/publicAgent";

export type WaitingAgentRecord = {
  id: string; displayName: string | null; photoURL: string | null; userId: number;
  visibility: "PRIVATE" | "TEAM"; members: readonly { projectId: number }[];
};

type WaitingData = {
  waitingOnAgentId?: unknown; waitingOnDisplayName?: unknown;
  waitingOnPrivate?: unknown; waitingOnAgentOwnerId?: unknown;
};

const waitingData = (activity: unknown): WaitingData | null => {
  if (!activity || typeof activity !== "object") return null;
  const row = activity as { type?: string; data?: WaitingData };
  return row.type === "TaskWaitingOn" && row.data && typeof row.data === "object" ? row.data : null;
};

const canSee = (agent: WaitingAgentRecord, userId: number, projectId: number) =>
  agent.userId === userId || (agent.visibility === "TEAM" && agent.members.some((member) => member.projectId === projectId));

const hides = (data: WaitingData, hiddenIds: ReadonlySet<string>, hiddenNames: ReadonlySet<string>, viewerUserId: number) => {
  const agentId = typeof data.waitingOnAgentId === "string" ? data.waitingOnAgentId : "";
  const name = typeof data.waitingOnDisplayName === "string" ? data.waitingOnDisplayName : "";
  const ownerId = typeof data.waitingOnAgentOwnerId === "number" ? data.waitingOnAgentOwnerId : null;
  if (data.waitingOnPrivate === true && ownerId === viewerUserId) return false;
  return (data.waitingOnPrivate === true && ownerId !== viewerUserId)
    || Boolean(agentId && hiddenIds.has(agentId))
    || Boolean(!agentId && name && hiddenNames.has(name));
};

export function collectWaitingTargets(comments: readonly { activity?: unknown }[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const comment of comments) {
    const data = waitingData(comment.activity);
    if (!data) continue;
    if (typeof data.waitingOnAgentId === "string" && data.waitingOnAgentId) ids.add(data.waitingOnAgentId);
    else if (typeof data.waitingOnDisplayName === "string" && data.waitingOnDisplayName) names.add(data.waitingOnDisplayName);
  }
  return { ids: [...ids], names: [...names] };
}

export function hiddenWaitingAgents(agents: readonly WaitingAgentRecord[], userId: number, projectId: number) {
  const hiddenIds = new Set<string>();
  const hiddenNames = new Set<string>();
  for (const agent of agents) {
    if (canSee(agent, userId, projectId)) continue;
    hiddenIds.add(agent.id);
    if (agent.visibility === "PRIVATE" && agent.displayName) hiddenNames.add(agent.displayName);
  }
  return { hiddenIds, hiddenNames };
}

export function concealedWaitingNames(
  comments: readonly { activity?: unknown }[], hiddenIds: ReadonlySet<string>, hiddenNames: ReadonlySet<string>, viewerUserId: number,
) {
  const names = new Set<string>();
  for (const comment of comments) {
    const data = waitingData(comment.activity);
    const original = typeof data?.waitingOnDisplayName === "string" ? data.waitingOnDisplayName : "";
    if (data && original && original !== PRIVATE_AGENT_DISPLAY_NAME && hides(data, hiddenIds, hiddenNames, viewerUserId)) names.add(original);
  }
  return [...names];
}

export function replaceConcealedNames(text: string, names: readonly string[]) {
  return [...new Set(names)].filter((name) => name && name !== PRIVATE_AGENT_DISPLAY_NAME)
    .sort((left, right) => right.length - left.length)
    .reduce((current, name) => current.split(name).join(PRIVATE_AGENT_DISPLAY_NAME), text);
}

export function redactWaitingOnActivity(
  activity: unknown, hiddenIds: ReadonlySet<string>, hiddenNames: ReadonlySet<string>, viewerUserId = 0,
) {
  const data = waitingData(activity);
  if (!data || !hides(data, hiddenIds, hiddenNames, viewerUserId)) return activity;
  const row = activity as { data: WaitingData };
  return { ...row, data: { ...row.data, waitingOnDisplayName: PRIVATE_AGENT_DISPLAY_NAME, waitingOnAgentId: null } };
}

export function presentWaitingAgent<T extends { waitingOnAgentId?: string | null; projectId?: number; waitingOnAgent?: unknown }>(
  task: T, agentsById: ReadonlyMap<string, WaitingAgentRecord>, viewerUserId: number,
) {
  if (!task.waitingOnAgentId) return task;
  const agent = agentsById.get(task.waitingOnAgentId);
  if (!agent || task.projectId == null || !canSee(agent, viewerUserId, task.projectId)) {
    return { ...task, waitingOnAgentId: null, waitingOnAgent: null };
  }
  return { ...task, waitingOnAgent: { id: agent.id, displayName: agent.displayName, photoURL: agent.photoURL } };
}
