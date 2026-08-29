import prisma from "@/lib/prisma";
import { subDays } from "date-fns";

export const CHAT_SESSION_EXPIRY_DAYS = 30;

interface ChatSessionExpiryJobPayload {
  sessionId: string;
}

export async function invokeChatSessionExpiry(job: ChatSessionExpiryJobPayload) {
  const { sessionId } = job;
  const expiryThreshold = subDays(new Date(), CHAT_SESSION_EXPIRY_DAYS);

  console.log(`[invokeChatSessionExpiry] Invoked for sessionId: ${sessionId}, expiryThreshold: ${expiryThreshold.toISOString()}`);

  const session = await prisma.chatSession.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      id: true,
      userId: true,
      updatedAt: true,
    },
  });

  if (!session) {
    console.log(`[invokeChatSessionExpiry] No session found for id: ${sessionId}`);
    return "skipped";
  }

  const deleted = await prisma.chatSession.deleteMany({
    where: {
      id: session.id,
      userId: session.userId,
      updatedAt: { lte: expiryThreshold },
    },
  });

  console.log(`[invokeChatSessionExpiry] Attempted to delete session id: ${session.id} (user: ${session.userId}) if updated before ${expiryThreshold.toISOString()}. Deleted count: ${deleted.count}`);

  if (deleted.count === 0) {
    console.log(`[invokeChatSessionExpiry] No sessions deleted for id: ${session.id}. Session may not be old enough or already deleted.`);
    return "skipped";
  }

  await recreateSessionIfEmpty(session.userId);
  return "deleted";
}

/**
 * Ensures a user always has at least one chat session: creates a fresh empty one
 * if none remain. Factored out so the sweep (src/pages/api/queues/sweep.ts) can
 * call it once per affected user after a batch delete, instead of once per
 * deleted session row.
 */
export async function recreateSessionIfEmpty(userId: number) {
  const remainingSessions = await prisma.chatSession.count({
    where: { userId },
  });

  console.log(`[recreateSessionIfEmpty] Remaining sessions for user ${userId}: ${remainingSessions}`);

  if (remainingSessions === 0) {
    console.log(`[recreateSessionIfEmpty] No remaining sessions for user ${userId}. Creating a new empty session...`);
    await prisma.chatSession.create({
      data: {
        userId,
      },
    });
    console.log(`[recreateSessionIfEmpty] New empty chat session created for user ${userId}`);
  }
}
