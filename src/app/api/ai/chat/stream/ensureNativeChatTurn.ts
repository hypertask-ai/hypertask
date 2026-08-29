import type { PrismaClient } from "@prisma/client";

type NativeChatPersistenceDb = Pick<PrismaClient, "chatMessage" | "chatSession">;

type EnsureNativeChatTurnArgs = {
  db: NativeChatPersistenceDb;
  sessionId: string;
  messageId: string;
  userId: number;
  content: string;
};

export type NativeChatTurnPersistence = "persisted" | "conflict";

export type NativeAssistantReplay =
  | { status: "missing" }
  | { status: "completed"; content: string }
  | { status: "conflict" };

type FindNativeAssistantReplayArgs = {
  db: Pick<PrismaClient, "chatMessage">;
  sessionId: string;
  messageId: string;
  userId: number;
};

/** Returns a durable completed reply without allowing an ID to cross ownership. */
export async function findNativeAssistantReplay({
  db,
  sessionId,
  messageId,
  userId,
}: FindNativeAssistantReplayArgs): Promise<NativeAssistantReplay> {
  const stored = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      sessionId: true,
      role: true,
      content: true,
      session: { select: { userId: true } },
    },
  });
  if (!stored) return { status: "missing" };
  if (
    stored.sessionId !== sessionId ||
    stored.role !== "assistant" ||
    stored.session.userId !== userId
  ) {
    return { status: "conflict" };
  }
  return { status: "completed", content: stored.content };
}

/**
 * Creates the native client's server session and stores its human message once.
 *
 * Android owns stable UUIDs in SQLite before the network starts. Accepting those
 * IDs here lets one streaming request make the chat durable without adding a
 * session-creation round trip to the perceived response latency.
 */
export async function ensureNativeChatTurn({
  db,
  sessionId,
  messageId,
  userId,
  content,
}: EnsureNativeChatTurnArgs): Promise<NativeChatTurnPersistence> {
  if (!content.trim()) return "conflict";

  await db.chatSession.createMany({
    data: [{ id: sessionId, userId }],
    skipDuplicates: true,
  });

  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) return "conflict";

  const created = await db.chatMessage.createMany({
    data: [
      {
        id: messageId,
        sessionId,
        content,
        role: "human",
        isDelivered: true,
      },
    ],
    skipDuplicates: true,
  });

  if (created.count === 0) {
    const storedMessage = await db.chatMessage.findFirst({
      where: { id: messageId, sessionId },
      select: { id: true, role: true, content: true },
    });
    if (
      storedMessage?.role !== "human" ||
      storedMessage.content !== content
    ) {
      return "conflict";
    }
  }

  try {
    await db.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  } catch (error) {
    // The message is already durable. Metadata freshness must not cause a retry
    // that could regenerate or duplicate the user's AI turn.
    console.error(
      "[ai/chat/stream] native session metadata update failed after persistence",
      error,
    );
  }
  return "persisted";
}
