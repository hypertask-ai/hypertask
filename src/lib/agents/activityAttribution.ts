/**
 * Task activity rows are Comment rows carrying an `activity` JSON blob. The
 * acting agent used to live only inside that blob, so "which agent did this?"
 * was not answerable without scanning JSON. HTPR-4620 stamps the same
 * `agentId` column that agent-authored comments and page versions already use.
 */
function activityFromAgent(activityBody: unknown): Record<string, unknown> | null {
  if (activityBody === null || typeof activityBody !== "object") return null;
  const data = (activityBody as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return null;
  const fromAgent = (data as Record<string, unknown>).fromAgent;
  if (fromAgent === null || typeof fromAgent !== "object") return null;
  return fromAgent as Record<string, unknown>;
}

export function activityAgentId(activityBody: unknown): string | null {
  const id = activityFromAgent(activityBody)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The agent row can be deleted later, and the FK then clears `Comment.agentId`,
 * so the only attribution that outlives the agent is the name copied onto the
 * row when the action happened.
 */
export function activityAgentDisplayName(activityBody: unknown): string | null {
  const displayName = activityFromAgent(activityBody)?.displayName;
  return typeof displayName === "string" && displayName.trim().length > 0
    ? displayName
    : null;
}

export const actingAgentSelect = {
  id: true,
  userId: true,
  displayName: true,
  photoURL: true,
} as const;

export type ActingAgent = {
  id: string;
  userId: number;
  displayName: string;
  photoURL: string | null;
};
