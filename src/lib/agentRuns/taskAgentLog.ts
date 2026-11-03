import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import prisma from "@/lib/prisma";

export type TaskAgentLogEntry = {
  id: string;
  agentId: string;
  agentName: string;
  runId: string;
  type: string;
  text: string;
  createdAt: string;
};

type LoadTaskAgentLogInput = {
  taskId: number;
  userId: number;
  callerAgentId: string | null;
  teamScope: AgentTokenTeamScope | null;
  limit: number;
  offset?: number;
  agentId?: string | null;
};

export async function loadTaskAgentLog({
  taskId,
  userId,
  callerAgentId,
  teamScope,
  limit,
  offset = 0,
  agentId = null,
}: LoadTaskAgentLogInput): Promise<TaskAgentLogEntry[]> {
  const rows = await prisma.agentRunActivity.findMany({
    where: {
      run: {
        taskId,
        ...(teamScope != null
          ? { task: { project: projectContentAccessWhere(userId, callerAgentId, teamScope) } }
          : {}),
        ...(agentId ? { agentId } : {}),
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(limit, 100),
    ...(offset > 0 ? { skip: offset } : {}),
    select: {
      id: true,
      runId: true,
      type: true,
      text: true,
      createdAt: true,
      run: { select: { agentId: true, agent: { select: { displayName: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    agentId: row.run.agentId,
    agentName: row.run.agent.displayName,
    runId: row.runId,
    type: row.type.toLowerCase(),
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  }));
}
