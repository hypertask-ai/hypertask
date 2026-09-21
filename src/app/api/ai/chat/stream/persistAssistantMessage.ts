import type { PrismaClient } from "@prisma/client";

type ChatPersistenceDb = Pick<PrismaClient, "chatMessage" | "chatSession">;

type PersistAssistantMessageArgs = {
  db: ChatPersistenceDb;
  messageId: string;
  sessionId: string;
  userId: number;
  content: string;
  linkify: (content: string, userId: number) => Promise<string>;
  /**
   * Tri-state: undefined keeps the existing rule (a native agent session
   * attributes its reply to that agent, a plain AI chat stays unattributed);
   * an explicit id attributes the reply to that agent (HTPR-6284 routed
   * @mention turn); explicit null forces unattributed even in an agent
   * session, e.g. a synthetic failure message the agent never wrote.
   */
  authorAgentId?: string | null;
};

/**
 * Stores one completed assistant reply under a client-provided id.
 *
 * The id makes a retried stream idempotent. Ownership is checked before the
 * write and again when reading the stored row, so an id collision can never
 * expose or mutate another session's message.
 */
export async function persistAssistantMessage({
  db,
  messageId,
  sessionId,
  userId,
  content,
  linkify,
  authorAgentId,
}: PersistAssistantMessageArgs): Promise<boolean> {
  if (!content.trim()) return false;

  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, agentId: true },
  });
  if (!session) return false;

  // Undefined means "decide from the session"; null is a deliberate override.
  const resolvedAuthorAgentId =
    authorAgentId === undefined ? session.agentId : authorAgentId;

  let storedContent = content;
  try {
    storedContent = await linkify(content, userId);
  } catch (error) {
    console.error(
      "[ai/chat/stream] assistant linkification failed, saving unlinked",
      error,
    );
  }

  const created = await db.chatMessage.createMany({
    data: [
      {
        id: messageId,
        sessionId,
        content: storedContent,
        role: "assistant",
        isDelivered: true,
        // A native agent's reply is that agent's. In a plain AI chat there is
        // no Agent row to point at, so the reply stays unattributed.
        authorAgentId: resolvedAuthorAgentId,
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
      storedMessage?.role !== "assistant" ||
      storedMessage.content !== storedContent
    ) {
      return false;
    }
  }

  try {
    await db.chatSession.update({
      where: { id: sessionId },
      data: {
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    // The reply is already durable. Returning false here would make a connected
    // client retry through add-message and create a duplicate assistant reply.
    console.error(
      "[ai/chat/stream] session metadata update failed after reply persistence",
      error,
    );
  }
  return true;
}
