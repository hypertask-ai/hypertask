import prisma from "@/lib/prisma";
import type { ShippedTicket } from "./entries";
import { RELEASE_SECTION_TITLES, toShippedTickets, type ReleaseEventRow } from "./selection";

export async function announcedTicketIds(): Promise<Set<number>> {
  const rows = await prisma.announcments.findMany({ select: { body: true } });
  const ids = new Set<number>();
  for (const row of rows) {
    const ticketIds = (row.body as { digest?: { ticketIds?: unknown } } | null)?.digest
      ?.ticketIds;
    if (!Array.isArray(ticketIds)) continue;
    for (const id of ticketIds) {
      if (typeof id === "number") ids.add(id);
    }
  }
  return ids;
}

export async function selectShippedTickets(
  projectId: number,
  since: Date,
  until: Date,
  announced: ReadonlySet<number> = new Set(),
  releaseSections: readonly string[] = RELEASE_SECTION_TITLES,
): Promise<ShippedTicket[]> {
  if (!releaseSections.length) return [];

  const rows = await prisma.taskSectionEvent.findMany({
    where: {
      timestamp: { gte: since, lte: until },
      to: { in: [...releaseSections] },
      task: { projectId, deletedAt: null },
    },
    select: {
      timestamp: true,
      task: {
        select: {
          uniqueIndex: true,
          title: true,
          description: true,
          section: true,
          deletedAt: true,
          description_: { select: { content: true } },
          taskLabels: { select: { label: { select: { value: true } } } },
        },
      },
    },
    orderBy: { timestamp: "asc" },
  });

  const live: ReleaseEventRow[] = rows.map(({ timestamp, task }) => ({
    timestamp,
    task: {
      uniqueIndex: task.uniqueIndex,
      title: task.title,
      description: task.description || task.description_?.content || "",
      section: task.section,
      deletedAt: task.deletedAt,
      taskLabels: task.taskLabels,
    },
  }));

  return toShippedTickets(live, releaseSections).filter(
    (ticket) => !announced.has(ticket.uniqueIndex),
  );
}
