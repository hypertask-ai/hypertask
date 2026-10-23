import { z } from "zod";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import type { ChatTicketGroupReferences, ChatTicketGroup } from "@/models/model";

export const ticketGroupsSchema = z.object({
  groups: z.array(z.object({
    label: z.string().trim().min(1).max(40).optional(),
    taskIds: z.array(z.number().int().positive()).min(1).max(50),
  })).min(1).max(4),
}).refine(({ groups }) => groups.reduce((total, group) => total + group.taskIds.length, 0) <= 50, {
  message: "At most 50 ticket IDs may be displayed per turn",
});

export function parseTicketGroupReferences(value: unknown): ChatTicketGroupReferences | undefined {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return;
  const parsed = ticketGroupsSchema.safeParse(value);
  return parsed.success ? { version: 1, groups: parsed.data.groups } : undefined;
}

export async function hydrateTicketGroups(
  groups: ChatTicketGroupReferences["groups"],
  userId: number,
  agent?: { id: string; teamScope: AgentTokenTeamScope | null } | null,
): Promise<ChatTicketGroup[]> {
  const ids = [...new Set(groups.flatMap((group) => group.taskIds))];
  if (!ids.length) return [];
  return withAgentScopeRequest({ url: "/api/ai/chat/stream", method: "GET" }, async () => {
    if (agent) await prepareAgentScope(userId, agent.id);
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: ids },
        status: { not: "Deleted" },
        project: { is: getProjectWhere(userId, agent?.id, agent?.teamScope) },
      },
      select: {
        id: true, title: true, ticketNumber: true, uniqueIndex: true, projectId: true,
        section: true,
        priority: { select: { id: true, priority_index: true, Priority_Value: true } },
        assignees: {
          where: { OR: [{ agentId: null }, { agent: boardAgentVisibilityWhere(userId) }] },
          select: {
            id: true,
            user: { select: { displayName: true, photoURL: true } },
            agent: { select: { id: true, displayName: true, photoURL: true } },
          },
        },
      },
    });
    const byId = new Map(tasks.map((task) => [task.id, {
      ...task,
      ticketNumber: task.ticketNumber ?? undefined,
      url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
    }]));
    return groups.map((group) => ({
      ...(group.label ? { label: group.label } : {}),
      tasks: group.taskIds.flatMap((id) => {
        const task = byId.get(id);
        return task ? [task] : [];
      }),
    })).filter((group) => group.tasks.length > 0);
  });
}

export async function hydrateChatTicketMessages<T extends { id: string; messages: { ticketGroups?: unknown }[] }>(
  session: T,
  userId: number,
  enabled: boolean,
) {
  const references = session.messages.map((message) => enabled ? parseTicketGroupReferences(message.ticketGroups) : undefined);
  const groups = references.flatMap((reference) => reference?.groups ?? []);
  let hydrated: ChatTicketGroup[] = [];
  if (groups.length) {
    try {
      const { loadActingAgent } = await import("@/lib/ai/tools/helpers");
      hydrated = await hydrateTicketGroups(groups, userId, await loadActingAgent(session.id, userId));
    } catch (error) {
      console.error("[ai/chat/history] ticket row hydration failed", error);
    }
  }
  const byId = new Map(hydrated.flatMap((group) => group.tasks).map((task) => [task.id, task]));
  return {
    ...session,
    messages: session.messages.map((message, index) => {
      const { ticketGroups: _storedGroups, ...rest } = message;
      const reference = references[index];
      if (!reference) return rest;
      return {
        ...rest,
        ticketGroups: reference.groups.map((group) => ({
          ...(group.label ? { label: group.label } : {}),
          tasks: group.taskIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
        })).filter((group) => group.tasks.length > 0),
      };
    }),
  };
}
