import prisma from "@/lib/prisma";
import { findTaskNumberAlias, parseDetailSlug, taskWhere } from "@/utils/controllers/taskDetail/load";

export type DeviceAccount = {
  userId: number;
  sessionToken: string;
};

export type TicketAccountSwitch =
  | { action: "stay" }
  | { action: "choose" }
  | { action: "switch"; sessionToken: string };

export async function openTicketForAccount(
  userId: number,
  projectSlug: string,
  uniqueIndex: string,
): Promise<{ id: number } | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const slug = parseDetailSlug([projectSlug, uniqueIndex]);
  if (!slug) return null;
  const task = await prisma.task.findFirst({
    where: taskWhere(slug, userId),
    select: { id: true },
  });
  if (task) return { id: task.id };
  const alias = await findTaskNumberAlias(slug, userId);
  if (!alias) return null;
  const current = await prisma.task.findFirst({
    where: taskWhere(alias, userId),
    select: { id: true },
  });
  return current ? { id: current.id } : null;
}

export function decideTicketAccountSwitch(
  currentUserId: number,
  accounts: DeviceAccount[],
  canOpen: (userId: number) => boolean,
): TicketAccountSwitch {
  const openers: DeviceAccount[] = [];
  const seen = new Set<number>();
  for (const account of accounts) {
    if (!Number.isInteger(account.userId) || account.userId <= 0) continue;
    if (account.userId === currentUserId) continue;
    if (typeof account.sessionToken !== "string" || account.sessionToken.length === 0) continue;
    if (seen.has(account.userId)) continue;
    seen.add(account.userId);
    if (!canOpen(account.userId)) continue;
    openers.push(account);
  }
  if (openers.length === 1) return { action: "switch", sessionToken: openers[0].sessionToken };
  if (openers.length > 1) return { action: "choose" };
  return { action: "stay" };
}

export async function resolveTicketAccountSwitch(input: {
  enabled: boolean;
  currentUserId: number;
  projectSlug: string;
  uniqueIndex: string;
  accounts: DeviceAccount[];
}): Promise<TicketAccountSwitch> {
  if (!input.enabled) return { action: "stay" };
  if (await openTicketForAccount(input.currentUserId, input.projectSlug, input.uniqueIndex)) {
    return { action: "stay" };
  }
  const open = new Map<number, boolean>();
  for (const account of input.accounts) {
    if (!Number.isInteger(account.userId) || open.has(account.userId) || account.userId === input.currentUserId) continue;
    open.set(
      account.userId,
      Boolean(await openTicketForAccount(account.userId, input.projectSlug, input.uniqueIndex)),
    );
  }
  return decideTicketAccountSwitch(
    input.currentUserId,
    input.accounts,
    (userId) => open.get(userId) === true,
  );
}
