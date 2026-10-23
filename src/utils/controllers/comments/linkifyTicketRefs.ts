import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  applyTicketRefLinks,
  buildUnambiguousRefMap,
  findLinkableTicketRefs,
} from "@/utils/controllers/comments/ticketRefLinker";

export async function linkifyTicketRefs(
  html: string,
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Promise<string> {
  const refs = findLinkableTicketRefs(html);
  if (refs.length === 0) return html;

  const tasks = await prisma.task.findMany({
    where: {
      ticketNumber: { in: refs },
      status: { not: "Deleted" },
      project: getProjectWhere(userId, agentId, teamScope),
    },
    select: { ticketNumber: true, projectId: true },
  });
  if (tasks.length === 0) return html;

  const refToProjectId = buildUnambiguousRefMap(
    tasks.filter((task): task is { ticketNumber: string; projectId: number } =>
      Boolean(task.ticketNumber)
    )
  );
  if (refToProjectId.size === 0) return html;

  return applyTicketRefLinks(html, refToProjectId);
}
