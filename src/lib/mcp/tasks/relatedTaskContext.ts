import { Prisma } from '@prisma/client';
import { accessibleAgentWhere } from '@/lib/agents/visibility';
import { resolvePublicAgentDisplayName } from '@/lib/agents/publicAgent';
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from '@/lib/mcp/agents';
import { mapTaskAssignees } from '@/lib/mcp/tasks/mappers';
import prisma from '@/lib/prisma';

export function relatedTaskContextSelect(userId: number) {
  return {
    id: true,
    ticketNumber: true,
    title: true,
    uniqueIndex: true,
    projectId: true,
    section: true,
    assignees: {
      where: { OR: [{ agentId: null }, { agent: accessibleAgentWhere(userId) }] },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        agent: { select: mcpVisibleAgentSelect(userId) },
        agentAssigner: { select: mcpVisibleAgentSelect(userId) },
      },
    },
  } satisfies Prisma.TaskSelect;
}

type RelatedTask = Prisma.TaskGetPayload<{ select: ReturnType<typeof relatedTaskContextSelect> }>;

export async function mapRelatedTaskContext(task: RelatedTask, userId: number, access: Prisma.TaskWhereInput) {
  const activities = await prisma.agentRunActivity.findMany({
    where: { run: { taskId: task.id, task: access } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: {
      id: true,
      type: true,
      text: true,
      createdAt: true,
      run: { select: { agent: { select: mcpVisibleAgentSelect(userId) } } },
    },
  });
  return {
    id: task.id,
    ticketNumber: task.ticketNumber || undefined,
    title: task.title,
    uniqueIndex: task.uniqueIndex,
    section: task.section,
    assignees: mapTaskAssignees(task.assignees, userId, task.projectId),
    agentActivities: activities.map((activity) => ({
      id: activity.id,
      agentName: resolvePublicAgentDisplayName({
        hasAgentRow: true,
        visibleAgent: mapVisibleMcpAgent(activity.run.agent, userId, task.projectId),
      }),
      type: activity.type.toLowerCase(),
      text: activity.text,
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}
