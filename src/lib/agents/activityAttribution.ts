/**
 * Task activity rows are Comment rows carrying an `activity` JSON blob. The
 * acting agent used to live only inside that blob, so "which agent did this?"
 * was not answerable without scanning JSON. HTPR-4620 stamps the same
 * `agentId` column that agent-authored comments and page versions already use.
 */
export function activityAgentId(activityBody: unknown): string | null {
  if (activityBody === null || typeof activityBody !== "object") return null;
  const data = (activityBody as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return null;
  const fromAgent = (data as Record<string, unknown>).fromAgent;
  if (fromAgent === null || typeof fromAgent !== "object") return null;
  const id = (fromAgent as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
