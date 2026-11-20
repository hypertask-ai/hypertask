import prisma from '@/lib/prisma';
import { boardAgentVisibilityWhere } from '@/lib/agents/visibility';
import type { TaskUpdateFieldContext, TaskUpdateTarget } from './types';

type AssignedAgentRow = {
    agentId: string | null;
    agent: { id: string; displayName: string | null } | null;
};

export class RemoveAgentRefusal extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
        readonly field: string,
    ) {
        super(message);
        this.name = 'RemoveAgentRefusal';
    }
}

type AssignedAgent = { agentId: string; displayName: string };

function assignedAgents(rows: AssignedAgentRow[]): AssignedAgent[] {
    return rows.flatMap((row) => row.agentId && row.agent
        ? [{ agentId: row.agentId, displayName: row.agent.displayName ?? '' }]
        : []);
}

function matchesName(agent: AssignedAgent, ref: string) {
    return agent.displayName.toLowerCase() === ref.toLowerCase();
}

export function resolveAgentIds(
    refs: string[],
    agents: AssignedAgent[],
): string[] {
    const resolved = new Set<string>();
    for (const ref of refs) {
        const byId = agents.find((agent) => agent.agentId === ref);
        if (byId) {
            resolved.add(byId.agentId);
            continue;
        }
        const byName = agents.filter((agent) => matchesName(agent, ref));
        if (byName.length === 1) {
            resolved.add(byName[0].agentId);
            continue;
        }
        if (byName.length > 1) {
            throw new RemoveAgentRefusal(
                `${byName.length} assigned agents are named "${ref}": ${byName.map((agent) => agent.agentId).join(', ')}. Pass the agent id instead.`,
                400,
                'invalid_field',
                'remove_agents',
            );
        }
    }
    return [...resolved];
}

async function unassignAgent(context: TaskUpdateFieldContext, taskId: number, agentId: string) {
    const { request, baseUrl } = context;
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
        throw new RemoveAgentRefusal('Missing Authorization for agent removal', 401, 'unauthorized', 'remove_agents');
    }
    const response = await fetch(`${baseUrl}/api/mcp/assignees/assign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
        },
        body: JSON.stringify({ task_id: taskId, agent_id: agentId, intent: 'unassign' }),
    });
    if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const message = (failure as { error?: string; message?: string }).error
            ?? (failure as { message?: string }).message
            ?? `Unassign failed: ${response.status}`;
        throw new RemoveAgentRefusal(message, response.status, 'invalid_field', 'remove_agents');
    }
    await response.json().catch(() => null);
}

export async function removeTaskAgents(context: TaskUpdateFieldContext, task: TaskUpdateTarget) {
    const { removeAgentRefs, userObj } = context;
    if (!removeAgentRefs?.length) return;

    const rows: AssignedAgentRow[] = await prisma.assignees.findMany({
        where: {
            taskId: task.id,
            agentId: { not: null },
            agent: boardAgentVisibilityWhere(userObj.id),
        },
        select: {
            agentId: true,
            agent: { select: { id: true, displayName: true } },
        },
    });

    for (const agentId of resolveAgentIds(removeAgentRefs, assignedAgents(rows))) {
        await unassignAgent(context, task.id, agentId);
    }
}
