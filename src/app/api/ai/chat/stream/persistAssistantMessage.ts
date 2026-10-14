import type { PrismaClient } from "@prisma/client";

type ChatPersistenceDb = Pick<PrismaClient, "chatMessage" | "chatSession">;

type PersistAssistantMessageArgs = {
  db: ChatPersistenceDb;
  messageId: string;
  sessionId: string;
  userId: number;
  content: string;
  linkify: (content: string, userId: number) => Promise<string>;
  authorAgentId?: string | null;
};

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
    console.error(
      "[ai/chat/stream] session metadata update failed after reply persistence",
      error,
    );
  }
  return true;
}
