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

const EMPTY_AI_CHAT_GRACE_MS = 15 * 60 * 1000;

export async function recreateSessionIfEmpty(userId: number) {
  void userId;
}

export async function purgeEmptyAiChats(now = new Date(), limit = 100) {
  const cutoff = new Date(now.getTime() - EMPTY_AI_CHAT_GRACE_MS);
  const stale = await prisma.chatSession.findMany({
    where: { agentId: null, updatedAt: { lt: cutoff }, messages: { none: {} } },
    select: { id: true },
    take: limit,
  });
  if (stale.length === 0) return 0;
  const deleted = await prisma.chatSession.deleteMany({
    where: {
      id: { in: stale.map((session) => session.id) },
      agentId: null,
      messages: { none: {} },
    },
  });
  return deleted.count;
}
