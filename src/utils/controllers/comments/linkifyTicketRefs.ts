/**
 * Turns plain-text Hypertask ticket references (e.g. HTPR-1234) inside an HTML
 * fragment into clickable links to the in-app ticket page, scoped to whatever
 * projects the given user/agent can access. Used to linkify AI-generated
 * responses (chat + @AI comment replies) where the model mentions a ticket
 * without wrapping it in an anchor itself.
 *
 * Refs already inside an existing <a> tag, or that don't resolve to a task
 * the caller can see, are left as plain text. The pure text-transform lives in
 * ticketRefLinker.ts (see ticketRefLinker.check.ts for its unit checks).
 */
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
  agentId?: string | null
): Promise<string> {
  const refs = findLinkableTicketRefs(html);
  if (refs.length === 0) return html;

  const tasks = await prisma.task.findMany({
    where: {
      ticketNumber: { in: refs },
      status: { not: "Deleted" },
      project: getProjectWhere(userId, agentId),
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
