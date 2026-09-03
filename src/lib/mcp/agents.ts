import prisma from '@/lib/prisma';

export interface McpAgentSummary {
  id: string;
  displayName: string;
}

export const mcpAgentSelect = {
  id: true,
  displayName: true,
  photoURL: true,
} as const;

type AgentRow = {
  id: string;
  displayName: string;
  photoURL: string | null;
} | null | undefined;

export function mapMcpAgent(agent: AgentRow): McpAgentSummary | undefined {
  if (!agent) return undefined;
  return {
    id: agent.id,
    displayName: agent.displayName,
  };
}

export async function getMcpSessionAgentSummary(
  agentId: string | null,
  userId: number
): Promise<McpAgentSummary | undefined> {
  if (!agentId) return undefined;
  const agentRow = await prisma.agent.findFirst({
    where: { id: agentId, userId, revokedAt: null },
    select: mcpAgentSelect,
  });
  return mapMcpAgent(agentRow);
}
