import { HTPR_7088_AGENT_COMMENT_FANOUT_FLAG } from "@/lib/flags/definitions/htpr-7088-agent-comment-fanout";

/** HTPR-7088 bugfix flag, keyed on the comment author. Loaded lazily so strict module stubs stay untouched. */
export async function isAgentCommentFanoutFixOn(authorUserId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_7088_AGENT_COMMENT_FANOUT_FLAG, authorUserId);
}

type AgentRecipientReader = {
  assignees: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
  follower: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
};

/**
 * Agents that get a comment.created webhook. Today: assigned agents. With the
 * HTPR-7088 fix: assigned and following agents, never the agent that wrote it.
 */
export async function findCommentWebhookAgentIds(
  tx: AgentRecipientReader,
  { taskId, authorAgentId, fixOn }: { taskId: number; authorAgentId?: string | null; fixOn: boolean },
): Promise<string[]> {
  const where = { taskId, agentId: { not: null } };
  const select = { agentId: true };
  const [assigned, followed] = await Promise.all([
    tx.assignees.findMany({ where, select }),
    fixOn ? tx.follower.findMany({ where, select }) : Promise.resolve([]),
  ]);
  const ids = [...assigned, ...followed]
    .map(({ agentId }) => agentId)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)].filter((id) => !(fixOn && id === authorAgentId));
}
