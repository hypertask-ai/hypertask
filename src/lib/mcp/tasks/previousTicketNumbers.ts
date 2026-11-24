import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9542_MOVED_TICKET_OLD_KEY_FLAG } from "@/lib/flags/definitions/htpr-9542-moved-ticket-old-key";
import prisma from "@/lib/prisma";

type NamedTask = {
  id: number;
  ticketNumber?: string | null;
};

type AliasRow = {
  id: number;
  taskId: number;
  ticketNumber: string | null;
  projectId: number;
  uniqueIndex: number;
  createdAt: Date | string;
};

function aliasTime(value: Date | string | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function resolvablePreviousTicketNumbers(
  tasks: readonly NamedTask[],
  aliases: readonly AliasRow[],
  occupied: readonly { projectId: number; uniqueIndex: number }[],
): Map<number, string[]> {
  const currentById = new Map(
    tasks.map((task) => [task.id, task.ticketNumber?.trim().toLowerCase() ?? ""]),
  );
  const taken = new Set(occupied.map((task) => `${task.projectId}:${task.uniqueIndex}`));
  const ordered = [...aliases].sort((left, right) => {
    const time = aliasTime(right.createdAt) - aliasTime(left.createdAt);
    return time || right.id - left.id;
  });
  const names = new Map<number, string[]>();
  for (const alias of ordered) {
    const ticketNumber = alias.ticketNumber?.trim();
    if (!ticketNumber) continue;
    if (ticketNumber.toLowerCase() === currentById.get(alias.taskId)) continue;
    if (taken.has(`${alias.projectId}:${alias.uniqueIndex}`)) continue;
    const list = names.get(alias.taskId) ?? [];
    if (list.some((key) => key.toLowerCase() === ticketNumber.toLowerCase())) continue;
    list.push(ticketNumber);
    names.set(alias.taskId, list);
  }
  return names;
}

export async function previousTicketNumbersByTask(
  tasks: readonly NamedTask[],
): Promise<Map<number, string[]>> {
  const ids = [...new Set(tasks.map((task) => task.id))];
  if (ids.length === 0) return new Map();
  const aliases = await prisma.taskNumberAlias.findMany({
    where: { taskId: { in: ids }, ticketNumber: { not: null } },
    select: {
      id: true,
      taskId: true,
      ticketNumber: true,
      projectId: true,
      uniqueIndex: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (aliases.length === 0) return new Map();
  const occupied = await prisma.task.findMany({
    where: {
      status: { not: "Deleted" },
      OR: aliases.map((alias) => ({
        projectId: alias.projectId,
        uniqueIndex: alias.uniqueIndex,
      })),
    },
    select: { projectId: true, uniqueIndex: true },
  });
  return resolvablePreviousTicketNumbers(tasks, aliases, occupied);
}

export async function previousTicketNumbersFor(
  userId: number,
  tasks: readonly NamedTask[],
): Promise<Map<number, string[]> | undefined> {
  let enabled = false;
  try {
    enabled = await isFeatureEnabled(HTPR_9542_MOVED_TICKET_OLD_KEY_FLAG, userId);
  } catch {
    enabled = false;
  }
  if (!enabled) return undefined;
  try {
    return await previousTicketNumbersByTask(tasks);
  } catch {
    return undefined;
  }
}

export function withPreviousTicketNumbers<T extends NamedTask>(
  task: T,
  previous: Map<number, string[]> | undefined,
): T & { previousTicketNumbers?: string[] } {
  const numbers = previous?.get(task.id);
  if (!numbers?.length) return task;
  return { ...task, previousTicketNumbers: numbers };
}

export async function nameMovedTicketKeys<T extends NamedTask>(
  userId: number,
  tasks: readonly T[],
): Promise<Array<T & { previousTicketNumbers?: string[] }>> {
  const previous = await previousTicketNumbersFor(userId, tasks);
  if (!previous) return tasks.map((task) => task);
  return tasks.map((task) => withPreviousTicketNumbers(task, previous));
}
