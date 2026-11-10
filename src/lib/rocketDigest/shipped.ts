import prisma from "@/lib/prisma";
import type { ShippedTicket } from "./entries";
import { RELEASE_SECTION_TITLES, toShippedTickets } from "./selection";

export async function selectShippedTickets(
  projectId: number,
  since: Date,
  until: Date,
  releaseSections: readonly string[] = RELEASE_SECTION_TITLES,
): Promise<ShippedTicket[]> {
  if (!releaseSections.length) return [];

  const rows = await prisma.taskSectionEvent.findMany({
    where: {
      timestamp: { gt: since, lte: until },
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
          taskLabels: { select: { label: { select: { value: true } } } },
        },
      },
    },
    orderBy: { timestamp: "asc" },
  });

  return toShippedTickets(rows, releaseSections);
}
