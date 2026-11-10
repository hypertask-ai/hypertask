import { PRIVATE_AGENT_DISPLAY_NAME } from "@/lib/agents/publicAgent";

export type WaitingAgentRecord = {
  id: string;
  displayName: string | null;
  photoURL: string | null;
  userId: number;
  visibility: "PRIVATE" | "TEAM";
  members: readonly { projectId: number }[];
};

function viewerCanSeeAgent(
  agent: WaitingAgentRecord,
  userId: number,
  projectId: number,
) {
  return (
    agent.userId === userId ||
    (agent.visibility === "TEAM" &&
      agent.members.some((membership) => membership.projectId === projectId))
  );
}

type WaitingActivity = {
  type?: string;
  data?: {
    waitingOnAgentId?: unknown;
    waitingOnDisplayName?: unknown;
  };
};

export function collectWaitingTargets(comments: readonly { activity?: unknown }[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const comment of comments) {
    const activity = waitingActivity(comment.activity);
    if (!activity?.data) continue;
    const agentId = activity.data.waitingOnAgentId;
    const name = activity.data.waitingOnDisplayName;
    if (typeof agentId === "string" && agentId) ids.add(agentId);
    else if (typeof name === "string" && name) names.add(name);
  }
  return { ids: [...ids], names: [...names] };
}

export function hiddenWaitingAgents(
  agents: readonly WaitingAgentRecord[],
  userId: number,
  projectId: number,
) {
  const hiddenIds = new Set<string>();
  const hiddenNames = new Set<string>();
  for (const agent of agents) {
    if (viewerCanSeeAgent(agent, userId, projectId)) continue;
    hiddenIds.add(agent.id);
    if (agent.visibility === "PRIVATE" && agent.displayName) hiddenNames.add(agent.displayName);
  }
  return { hiddenIds, hiddenNames };
}

export function redactWaitingOnActivity(
  activity: unknown,
  hiddenIds: ReadonlySet<string>,
  hiddenNames: ReadonlySet<string>,
): unknown {
  const row = waitingActivity(activity);
  if (!row?.data) return activity;
  const agentId = typeof row.data.waitingOnAgentId === "string" ? row.data.waitingOnAgentId : "";
  const name = typeof row.data.waitingOnDisplayName === "string" ? row.data.waitingOnDisplayName : "";
  const hidden = (agentId && hiddenIds.has(agentId)) || (!agentId && name && hiddenNames.has(name));
  if (!hidden) return activity;
  return {
    ...row,
    data: {
      ...row.data,
      waitingOnDisplayName: PRIVATE_AGENT_DISPLAY_NAME,
      waitingOnAgentId: null,
    },
  };
}

export function presentWaitingAgent<T extends {
  waitingOnAgentId?: string | null;
  projectId?: number;
  waitingOnAgent?: unknown;
}>(
  task: T,
  agentsById: ReadonlyMap<string, WaitingAgentRecord>,
  viewerUserId: number,
): T {
  const agentId = task.waitingOnAgentId;
  if (!agentId) return task;
  const agent = agentsById.get(agentId);
  const projectId = task.projectId;
  if (!agent || projectId == null || !viewerCanSeeAgent(agent, viewerUserId, projectId)) {
    return { ...task, waitingOnAgentId: null, waitingOnAgent: null };
  }
  return {
    ...task,
    waitingOnAgent: {
      id: agent.id,
      displayName: agent.displayName,
      photoURL: agent.photoURL,
    },
  };
}

function waitingActivity(activity: unknown): WaitingActivity | null {
  if (!activity || typeof activity !== "object") return null;
  const row = activity as WaitingActivity;
  if (row.type !== "TaskWaitingOn" || !row.data || typeof row.data !== "object") return null;
  return row;
}
