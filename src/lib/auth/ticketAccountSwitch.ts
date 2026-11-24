import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6868_TICKET_PREFIX_FLAG } from "@/lib/flags/definitions/htpr-6868-ticket-prefix";
import { Status } from "@prisma/client";
import {
  findTaskByTicketNumber,
  parseDetailSlug,
  parseProjectSlug,
  taskWhere,
} from "@/utils/controllers/taskDetail/load";

export type DeviceAccount = {
  userId: number;
  sessionToken: string;
};

export type TicketAccountSwitch =
  | { action: "stay" }
  | { action: "choose" }
  | { action: "switch"; sessionToken: string };

const PREFIXED_TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]*-\d+$/;

async function readNumberedTicket(
  userId: number,
  slug: { projectId: number; uniqueIndex: number },
): Promise<{ id: number } | null> {
  const [visible, live, alias] = await Promise.all([
    prisma.task.findFirst({
      where: taskWhere(slug, userId),
      select: { id: true },
    }),
    prisma.task.findFirst({
      where: { ...slug, status: { not: Status.Deleted } },
      select: { id: true },
    }),
    prisma.taskNumberAlias.findUnique({
      where: { projectId_uniqueIndex: slug },
      select: { task: { select: { id: true, projectId: true, uniqueIndex: true } } },
    }),
  ]);
  const follow = !live && alias?.task ? alias.task : null;
  const destination = await prisma.task.findFirst({
    where: taskWhere(follow ?? slug, userId),
    select: { id: true },
  });
  if (visible) return { id: visible.id };
  if (!follow || !destination) return null;
  return { id: destination.id };
}

export async function openTicketForAccount(
  userId: number,
  projectSlug: string,
  uniqueIndex: string,
): Promise<{ id: number } | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (PREFIXED_TICKET.test(uniqueIndex)) {
    if (!(await isFeatureEnabled(HTPR_6868_TICKET_PREFIX_FLAG, userId))) return null;
    const projectId = parseProjectSlug(projectSlug);
    if (!Number.isInteger(projectId)) return null;
    const task = await findTaskByTicketNumber(uniqueIndex, userId, projectId);
    return task ? { id: task.id } : null;
  }
  const slug = parseDetailSlug([projectSlug, uniqueIndex]);
  if (!slug) return null;
  return readNumberedTicket(userId, slug);
}

export async function siblingSessions(
  accounts: DeviceAccount[],
  now = new Date(),
): Promise<DeviceAccount[]> {
  const verified: DeviceAccount[] = [];
  const seen = new Set<number>();
  for (const account of accounts) {
    if (!Number.isInteger(account.userId) || account.userId <= 0) continue;
    if (typeof account.sessionToken !== "string" || account.sessionToken.length === 0) continue;
    if (seen.has(account.userId)) continue;
    const row = await prisma.betterAuthSession.findFirst({
      where: {
        token: account.sessionToken,
        userId: account.userId,
        expiresAt: { gt: now },
      },
      select: { userId: true },
    });
    if (!row || row.userId !== account.userId) continue;
    seen.add(account.userId);
    verified.push({ userId: account.userId, sessionToken: account.sessionToken });
  }
  return verified;
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
