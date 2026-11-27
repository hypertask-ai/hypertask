type AgentRecipientReader = {
  assignees: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
  follower: { findMany: (args: any) => Promise<Array<{ agentId: string | null }>> };
};

export async function findCommentWebhookAgentIds(
  tx: AgentRecipientReader,
  { taskId, authorAgentId }: { taskId: number; authorAgentId?: string | null },
): Promise<string[]> {
  const where = { taskId, agentId: { not: null } };
  const select = { agentId: true };
  const [assigned, followed] = await Promise.all([
    tx.assignees.findMany({ where, select }),
    tx.follower.findMany({ where, select }),
  ]);
  const ids = [...assigned, ...followed]
    .map(({ agentId }) => agentId)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)].filter((id) => id !== authorAgentId);
}
