import prisma from '@/lib/prisma';
import {
  accessibleAgentMembershipWhere,
  isAgentVisibleToUser,
  type AgentVisibility,
} from '@/lib/agents/visibility';

export interface McpAgentSummary {
  id: string;
  displayName: string;
}

export const mcpAgentSelect = {
  id: true,
  displayName: true,
  photoURL: true,
} as const;

export function mcpVisibleAgentSelect(userId: number) {
  return {
    ...mcpAgentSelect,
    userId: true,
    visibility: true,
    members: {
      where: accessibleAgentMembershipWhere(userId),
      select: { id: true },
      take: 1,
    },
  } as const;
}

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

export function mapVisibleMcpAgent(
  agent:
    | (NonNullable<AgentRow> & {
        userId: number;
        visibility: AgentVisibility;
        members: readonly unknown[];
      })
    | null
    | undefined,
  userId: number,
): McpAgentSummary | undefined {
  return agent && isAgentVisibleToUser(agent, userId)
    ? mapMcpAgent(agent)
    : undefined;
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
