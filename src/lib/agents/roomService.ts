import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  AGENT_ROOM_BOT_TURN_LIMIT,
  mentionedRoomAgents,
  nextRoomBotDepth,
  roomBudgetWindow,
} from "@/lib/agents/roomPolicy";

export const AGENT_ROOM_MAX_MESSAGE_LENGTH = 8_000;
export const AGENT_ROOM_TRANSCRIPT_LIMIT = 200;
export const AGENT_ROOM_STOPPED_MESSAGE = "Turn stopped";
export const AGENT_ROOM_TURN_LIMIT_MESSAGE =
  "Bot exchange limit reached. Continue this work on the ticket.";
export const AGENT_ROOM_DAILY_BUDGET_MESSAGE =
  "Daily room turn budget reached. Continue tomorrow.";

export class AgentRoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const roomMessageInclude = {
  authorUser: { select: { id: true, displayName: true, photoURL: true } },
  authorAgent: {
    select: { id: true, displayName: true, photoURL: true },
  },
  task: { select: { id: true, ticketNumber: true, title: true } },
} satisfies Prisma.AgentRoomMessageInclude;

type RoomMessage = Prisma.AgentRoomMessageGetPayload<{
  include: typeof roomMessageInclude;
}>;

export function serializeAgentRoomMessage(message: RoomMessage) {
  return {
    id: message.id,
    role:
      message.role === "assistant" &&
      !message.authorAgentId &&
      !message.authorUserId
        ? ("system" as const)
        : message.role,
    content: message.content,
    botTurnDepth: message.botTurnDepth,
    createdAt: message.createdAt,
    stoppedAt: message.stoppedAt,
    replyToMessageId: message.replyToMessageId,
    author: message.authorAgent
      ? {
          type: "agent" as const,
          id: message.authorAgent.id,
          displayName: message.authorAgent.displayName,
          photoURL: message.authorAgent.photoURL,
        }
      : message.authorUser
        ? {
            type: "user" as const,
            id: String(message.authorUser.id),
            displayName: message.authorUser.displayName || "Hypertask user",
            photoURL: message.authorUser.photoURL,
          }
        : null,
    task: message.task
      ? {
          id: message.task.id,
          ticketNumber: message.task.ticketNumber,
          title: message.task.title,
        }
      : null,
  };
}

function extractTicketNumber(text: string): string | null {
  return text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/i)?.[0]?.toUpperCase() ?? null;
}

async function findRoomTask(
  tx: Prisma.TransactionClient,
  projectId: number,
  ticketNumber: string | null,
) {
  if (!ticketNumber) return null;
  return tx.task.findFirst({
    where: {
      projectId,
      status: { not: "Deleted" },
      ticketNumber: { equals: ticketNumber, mode: "insensitive" },
    },
    select: { id: true, ticketNumber: true, title: true },
  });
}

export async function listAgentRoom(roomId: string, now = new Date()) {
  const { start, end } = roomBudgetWindow(now);
  const [room, messages, agents, turnsUsed, pending] = await Promise.all([
    prisma.agentRoom.findUnique({
      where: { id: roomId },
      include: { project: { select: { id: true, name: true, title: true } } },
    }),
    prisma.agentRoomMessage.findMany({
      where: { roomId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: AGENT_ROOM_TRANSCRIPT_LIMIT,
      include: roomMessageInclude,
    }),
    prisma.member.findMany({
      where: {
        project: { agentRoom: { id: roomId } },
        status: "Accepted",
        agentId: { not: null },
        agent: { revokedAt: null, archivedAt: null },
      },
      orderBy: { agent: { displayName: "asc" } },
      select: {
        agent: {
          select: {
            id: true,
            displayName: true,
            photoURL: true,
            runtimeType: true,
          },
        },
      },
    }),
    prisma.agentRoomMessage.count({
      where: {
        roomId,
        authorAgentId: { not: null },
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.agentRoomDelivery.findMany({
      where: {
        handledAt: null,
        message: { roomId, stoppedAt: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        messageId: true,
        agent: { select: { id: true, displayName: true } },
      },
    }),
  ]);
  if (!room) throw new AgentRoomError("Room not found", 404);
  return {
    room: {
      id: room.id,
      projectId: room.projectId,
      name: room.project.title ?? room.project.name,
    },
    agents: agents.flatMap(({ agent }) => (agent ? [agent] : [])),
    messages: messages.reverse().map(serializeAgentRoomMessage),
    budget: { used: turnsUsed, limit: room.dailyTurnBudget },
    pending,
  };
}

export async function createHumanAgentRoomMessage(input: {
  roomId: string;
  userId: number;
  text: string;
  ticketNumber?: string | null;
  now?: Date;
}) {
  const text = input.text.trim();
  if (!text || text.length > AGENT_ROOM_MAX_MESSAGE_LENGTH) {
    throw new AgentRoomError("Message must be 1 to 8000 characters", 400);
  }

  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const [room] = await tx.$queryRaw<
      Array<{ id: string; projectId: number; dailyTurnBudget: number }>
    >`SELECT "id", "projectId", "dailyTurnBudget" FROM "AgentRoom" WHERE "id" = ${input.roomId} FOR UPDATE`;
    if (!room) throw new AgentRoomError("Room not found", 404);

    const { start, end } = roomBudgetWindow(now);
    const turnsUsed = await tx.agentRoomMessage.count({
      where: {
        roomId: room.id,
        authorAgentId: { not: null },
        createdAt: { gte: start, lt: end },
      },
    });
    if (turnsUsed >= room.dailyTurnBudget) {
      throw new AgentRoomError("Daily room turn budget reached", 429);
    }

    const productBot = await tx.member.findFirst({
      where: {
        projectId: room.projectId,
        status: "Accepted",
        agent: {
          revokedAt: null,
          archivedAt: null,
          displayName: { equals: "Product Bot", mode: "insensitive" },
        },
      },
      select: { agentId: true },
    });
    if (!productBot?.agentId) {
      throw new AgentRoomError("Product Bot is not on this board", 409);
    }

    const task = await findRoomTask(
      tx,
      room.projectId,
      input.ticketNumber?.trim() || extractTicketNumber(text),
    );
    const message = await tx.agentRoomMessage.create({
      data: {
        roomId: room.id,
        content: text,
        role: "human",
        exchangeId: crypto.randomUUID(),
        authorUserId: input.userId,
        taskId: task?.id,
        createdAt: now,
      },
      include: roomMessageInclude,
    });
    await tx.agentRoomDelivery.create({
      data: { messageId: message.id, agentId: productBot.agentId },
    });
    await tx.agentRoom.update({
      where: { id: room.id },
      data: { updatedAt: message.createdAt },
    });
    return serializeAgentRoomMessage(message);
  });
}

export async function createAgentRoomReply(input: {
  roomId: string;
  agentId: string;
  text: string;
  replyToMessageId: string;
  ticketNumber?: string | null;
  now?: Date;
}) {
  const text = input.text.trim();
  if (!text || text.length > AGENT_ROOM_MAX_MESSAGE_LENGTH) {
    throw new AgentRoomError("text must be 1 to 8000 characters", 400);
  }
  if (!input.replyToMessageId.trim()) {
    throw new AgentRoomError("replyToMessageId is required", 400);
  }
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const [room] = await tx.$queryRaw<
      Array<{ id: string; projectId: number; dailyTurnBudget: number }>
    >`SELECT "id", "projectId", "dailyTurnBudget" FROM "AgentRoom" WHERE "id" = ${input.roomId} FOR UPDATE`;
    if (!room) throw new AgentRoomError("Room not found", 404);

    const existing = await tx.agentRoomMessage.findFirst({
      where: {
        roomId: room.id,
        replyToMessageId: input.replyToMessageId,
        authorAgentId: input.agentId,
      },
      include: roomMessageInclude,
    });
    if (existing) {
      return {
        message: serializeAgentRoomMessage(existing),
        duplicate: true,
        routedTo: [] as string[],
        turnLimitReached: existing.botTurnDepth >= AGENT_ROOM_BOT_TURN_LIMIT,
      };
    }

    const delivery = await tx.agentRoomDelivery.findUnique({
      where: {
        messageId_agentId: {
          messageId: input.replyToMessageId,
          agentId: input.agentId,
        },
      },
      include: { message: true },
    });
    if (
      !delivery ||
      delivery.handledAt ||
      delivery.message.roomId !== room.id ||
      delivery.message.stoppedAt
    ) {
      throw new AgentRoomError("This room turn is no longer active", 409);
    }

    const botTurnDepth = nextRoomBotDepth(delivery.message.botTurnDepth);
    if (botTurnDepth === null) {
      throw new AgentRoomError("Bot turn limit reached", 409);
    }
    const exchangeTurns = await tx.agentRoomMessage.count({
      where: {
        roomId: room.id,
        exchangeId: delivery.message.exchangeId,
        authorAgentId: { not: null },
      },
    });
    if (exchangeTurns >= AGENT_ROOM_BOT_TURN_LIMIT) {
      throw new AgentRoomError("Bot turn limit reached", 409);
    }
    const { start, end } = roomBudgetWindow(now);
    const turnsUsed = await tx.agentRoomMessage.count({
      where: {
        roomId: room.id,
        authorAgentId: { not: null },
        createdAt: { gte: start, lt: end },
      },
    });
    if (turnsUsed >= room.dailyTurnBudget) {
      throw new AgentRoomError("Daily room turn budget reached", 429);
    }

    const task =
      (input.ticketNumber?.trim()
        ? await findRoomTask(tx, room.projectId, input.ticketNumber.trim())
        : null) ??
      (delivery.message.taskId
        ? await tx.task.findFirst({
            where: {
              id: delivery.message.taskId,
              projectId: room.projectId,
              status: { not: "Deleted" },
            },
            select: { id: true, ticketNumber: true, title: true },
          })
        : await findRoomTask(tx, room.projectId, extractTicketNumber(text)));

    const message = await tx.agentRoomMessage.create({
      data: {
        roomId: room.id,
        content: text,
        role: "assistant",
        exchangeId: delivery.message.exchangeId,
        botTurnDepth,
        replyToMessageId: delivery.message.id,
        authorAgentId: input.agentId,
        taskId: task?.id,
        createdAt: now,
      },
      include: roomMessageInclude,
    });
    await tx.agentRoomDelivery.update({
      where: { id: delivery.id },
      data: { handledAt: now },
    });

    if (task) {
      await tx.agentRun.create({
        data: {
          agentId: input.agentId,
          taskId: task.id,
          trigger: "RUNTIME",
          status: "DONE",
          title: `Agent room: ${task.ticketNumber ?? task.title}`,
          createdAt: now,
          lastActivityAt: now,
          activities: {
            create: {
              type: "ACTION",
              text,
              idempotencyKey: `agent-room:${message.id}`,
              createdAt: now,
            },
          },
        },
      });
    }

    const boardAgents = (
      await tx.member.findMany({
        where: {
          projectId: room.projectId,
          status: "Accepted",
          agentId: { not: null },
          agent: { revokedAt: null, archivedAt: null },
        },
        select: { agent: { select: { id: true, displayName: true } } },
      })
    ).flatMap(({ agent }) => (agent ? [agent] : []));
    const addressed = mentionedRoomAgents(text, boardAgents, input.agentId);
    const turnLimitReached =
      exchangeTurns + 1 >= AGENT_ROOM_BOT_TURN_LIMIT;
    const dailyBudgetReached = turnsUsed + 1 >= room.dailyTurnBudget;
    const routedTo = turnLimitReached || dailyBudgetReached ? [] : addressed;
    if (turnLimitReached || dailyBudgetReached) {
      await tx.agentRoomDelivery.updateMany({
        where: {
          handledAt: null,
          message: { roomId: room.id, exchangeId: delivery.message.exchangeId },
        },
        data: { handledAt: now },
      });
      await tx.agentRoomMessage.create({
        data: {
          roomId: room.id,
          content: turnLimitReached
            ? AGENT_ROOM_TURN_LIMIT_MESSAGE
            : AGENT_ROOM_DAILY_BUDGET_MESSAGE,
          role: "assistant",
          exchangeId: delivery.message.exchangeId,
          botTurnDepth,
          taskId: task?.id,
          createdAt: new Date(now.getTime() + 1),
        },
      });
    } else if (routedTo.length > 0) {
      await tx.agentRoomDelivery.createMany({
        data: routedTo.map((agentId) => ({ messageId: message.id, agentId })),
        skipDuplicates: true,
      });
    }
    await tx.agentRoom.update({
      where: { id: room.id },
      data: { updatedAt: now },
    });
    return {
      message: serializeAgentRoomMessage(message),
      duplicate: false,
      routedTo,
      turnLimitReached,
    };
  });
}

export async function markAgentRoomMessageHandled(input: {
  messageId: string;
  agentId: string;
  now?: Date;
}) {
  const updated = await prisma.agentRoomDelivery.updateMany({
    where: {
      messageId: input.messageId,
      agentId: input.agentId,
      handledAt: null,
    },
    data: { handledAt: input.now ?? new Date() },
  });
  return updated.count > 0;
}

export async function stopAgentRoomTurn(input: {
  roomId: string;
  messageId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const [room] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AgentRoom" WHERE "id" = ${input.roomId} FOR UPDATE
    `;
    if (!room) return false;
    const target = await tx.agentRoomMessage.findFirst({
      where: { id: input.messageId, roomId: room.id, stoppedAt: null },
      select: { exchangeId: true },
    });
    if (!target) return false;
    const stoppedDeliveries = await tx.agentRoomDelivery.updateMany({
      where: { messageId: input.messageId, handledAt: null },
      data: { handledAt: now },
    });
    if (stoppedDeliveries.count === 0) return false;
    const stopped = await tx.agentRoomMessage.updateMany({
      where: { id: input.messageId, roomId: room.id, stoppedAt: null },
      data: { stoppedAt: now },
    });
    if (stopped.count === 0) return false;
    await tx.agentRoomMessage.create({
      data: {
        roomId: room.id,
        content: AGENT_ROOM_STOPPED_MESSAGE,
        role: "assistant",
        exchangeId: target.exchangeId,
        createdAt: now,
      },
    });
    await tx.agentRoom.update({
      where: { id: room.id },
      data: { updatedAt: now },
    });
    return true;
  });
}
