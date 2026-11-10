import prisma from "@/lib/prisma";
import { accountCategory } from "@/lib/telemetry/accountCategory";

const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONNECTION_LOG = "cli_token_exchange";
const PROBE_EVENT_KINDS = ["board_created", "task_created", "invite_sent"];

export type ProbeEvent = { kind: string; processed: boolean };

export type ProbeState = {
  userId: number;
  accountCategory: string;
  boardId: number | null;
  taskCount: number;
  memberCount: number;
  pendingInviteCount: number;
  connectionCount: number;
  events: ProbeEvent[];
};

type IntentRow = { kind: string; payload: unknown; processedAt: Date | null };

function matchesProbe(kind: string, payload: unknown, userId: number): boolean {
  const value = (payload ?? {}) as {
    actor?: { userId?: number };
    inviterUserId?: number;
  };
  if (kind === "board_created" || kind === "task_created") {
    return value.actor?.userId === userId;
  }
  if (kind === "invite_sent") return value.inviterUserId === userId;
  return false;
}

export async function readProbeState(email: string): Promise<ProbeState | null> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, uid: true, email: true },
  });
  if (!user) return null;
  const board = await prisma.project.findFirst({
    where: { ownerId: user.id, status: "Normal" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const since = new Date(Date.now() - EVENT_WINDOW_MS);
  const [taskCount, memberCount, pendingInviteCount, connectionCount, intents] = await Promise.all([
    board ? prisma.task.count({ where: { projectId: board.id, status: "Normal" } }) : 0,
    board ? prisma.member.count({ where: { projectId: board.id, status: "Accepted" } }) : 0,
    board ? prisma.invite.count({ where: { projectId: board.id } }) : 0,
    prisma.logs.count({
      where: { LoggedById: user.id, log: CONNECTION_LOG, createdAt: { gte: since } },
    }),
    prisma.analyticsIntent.findMany({
      where: { kind: { in: PROBE_EVENT_KINDS }, createdAt: { gte: since } },
      select: { kind: true, payload: true, processedAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const events = (intents as IntentRow[])
    .filter((row) => matchesProbe(row.kind, row.payload, user.id))
    .map((row) => ({ kind: row.kind, processed: row.processedAt !== null }));

  return {
    userId: user.id,
    accountCategory: accountCategory({ id: user.id, uid: user.uid, email: user.email }),
    boardId: board?.id ?? null,
    taskCount,
    memberCount,
    pendingInviteCount,
    connectionCount,
    events,
  };
}
