import { HTPR_7088_AGENT_COMMENT_FANOUT_FLAG } from "@/lib/flags/definitions/htpr-7088-agent-comment-fanout";

export async function isAgentCommentFanoutFixOn(authorUserId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_7088_AGENT_COMMENT_FANOUT_FLAG, authorUserId);
}

type AgentRecipientReader = {
  assignees: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
  follower: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
};

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
