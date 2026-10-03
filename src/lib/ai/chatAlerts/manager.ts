import type { PrismaClient } from "@prisma/client";
import { persistAgentRunTriggerWebhooks, publishAgentWebhookDeliveries } from "@/lib/agentWebhooks/outbox";
import { broadcastChatSession } from "@/lib/agents/chatBroadcast";
import { FEATURE_FLAG_OWNER_USER_ID } from "@/lib/flags";
import { alertMessage, type AlertDelivery } from "./policy";

export async function deliverManagerAlert(db: PrismaClient, delivery: AlertDelivery) {
  const configuredId = process.env.AI_CHAT_ALERT_MANAGER_AGENT_ID?.trim();
  const manager = await db.agent.findFirst({
    where: {
      ...(configuredId ? { id: configuredId } : { displayName: "Manager" }),
      userId: FEATURE_FLAG_OWNER_USER_ID,
      runtimeType: "EXTERNAL",
      revokedAt: null,
    },
    select: { id: true, userId: true, runtimeType: true },
  });
  if (!manager) throw new Error("AI Chat alert Manager is not configured");
  const text = alertMessage(delivery);
  const messageId = `ai-chat-alert:${delivery.id}`;
  const { sessionId, deliveryIds } = await db.$transaction(async (tx) => {
    // Match Agent Chat's lock order so a runtime heartbeat cannot race handoff.
    const agents = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Agent" WHERE "id" = ${manager.id} AND "revokedAt" IS NULL FOR UPDATE`;
    if (!agents.length) throw new Error("AI Chat alert Manager is unavailable");
    const session = await tx.chatSession.upsert({
      where: { userId_agentId: { userId: manager.userId, agentId: manager.id } },
      create: { userId: manager.userId, agentId: manager.id },
      update: {},
      select: { id: true },
    });
    // A retry after an uncertain commit cannot create a second Manager alert.
    await tx.$queryRaw`SELECT "id" FROM "ChatSession" WHERE "id" = ${session.id} FOR UPDATE`;
    const existing = await tx.chatMessage.findUnique({ where: { id: messageId }, select: { id: true } });
    if (existing) return { sessionId: session.id, deliveryIds: [] };
    await tx.chatMessage.create({
      data: { id: messageId, sessionId: session.id, role: "human", content: text, isDelivered: false },
    });
    const deliveryIds = await persistAgentRunTriggerWebhooks(tx, {
      event: "chat.message",
      agentId: manager.id,
      projectId: null,
      taskId: null,
      ticketNumber: null,
      taskTitle: null,
      actor: { userId: manager.userId, displayName: "AI Chat monitor" },
      chat: { sessionId: session.id, messageId, text, userName: "AI Chat monitor" },
    });
    const subscription = await tx.agentWebhookSubscription.findUnique({ where: { agentId: manager.id }, select: { active: true } });
    if (subscription?.active && !deliveryIds.length) {
      throw new Error("AI Chat alert Manager webhook does not accept chat messages");
    }
    if (deliveryIds.length) {
      await tx.chatMessage.update({ where: { id: messageId }, data: { isDelivered: true } });
    }
    await tx.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
    return { sessionId: session.id, deliveryIds };
  }, { timeout: 10_000 });
  // Existing webhook outbox retries transport failures; polling runtimes read
  // the undelivered message through the existing Agent Chat pending endpoint.
  await publishAgentWebhookDeliveries(deliveryIds);
  await broadcastChatSession(sessionId, [manager.userId]);
}
