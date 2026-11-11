import prisma from "@/lib/prisma";
import type { ShippedTicket } from "./entries";
import { RELEASE_SECTION_TITLES, toShippedTickets, type ReleaseEventRow } from "./selection";

export async function announcedTicketIds(exclude: readonly number[] = []): Promise<Set<number>> {
  const rows = await prisma.announcments.findMany({
    ...(exclude.length ? { where: { id: { notIn: [...exclude] } } } : {}),
    select: { body: true },
  });
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

function toRows(
  entries: readonly {
    timestamp: Date;
    task: {
      uniqueIndex: number;
      title: string;
      description: string;
      section: string;
      deletedAt: Date | null;
      description_: { content: string } | null;
      taskLabels: { label: { value: string | null } }[];
    };
  }[],
): ReleaseEventRow[] {
  return entries.map(({ timestamp, task }) => ({
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

  const sitting = await prisma.task.findMany({
    where: {
      projectId,
      deletedAt: null,
      section: { in: [...releaseSections] },
      sectionChangedAt: { gte: since, lte: until },
    },
    select: {
      uniqueIndex: true,
      title: true,
      description: true,
      section: true,
      deletedAt: true,
      sectionChangedAt: true,
      description_: { select: { content: true } },
      taskLabels: { select: { label: { select: { value: true } } } },
    },
  });

  const events: ReleaseEventRow[] = toRows(rows);
  const current: ReleaseEventRow[] = toRows(
    sitting.map((task) => ({ timestamp: task.sectionChangedAt, task })),
  );

  return toShippedTickets([...events, ...current]).filter(
    (ticket) => !announced.has(ticket.uniqueIndex),
  );
}
