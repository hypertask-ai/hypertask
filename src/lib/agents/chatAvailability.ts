export const AGENT_CHAT_HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1000;

export type AgentChatDeliveryMode = "webhook" | "polling" | null;

type ChatAvailability = {
  heartbeatAt: Date | null;
  subscription: { active: boolean; events: string[] } | null;
};

export function hasFreshAgentChatHeartbeat(
  heartbeatAt: Date | null,
  now = new Date(),
): boolean {
  return Boolean(
    heartbeatAt &&
      heartbeatAt.getTime() > now.getTime() - AGENT_CHAT_HEARTBEAT_MAX_AGE_MS,
  );
}

export function agentChatDeliveryMode(
  availability: ChatAvailability,
  now = new Date(),
): AgentChatDeliveryMode {
  if (availability.subscription?.active) {
    return availability.subscription.events.includes("chat.message")
      ? "webhook"
      : null;
  }
  return hasFreshAgentChatHeartbeat(availability.heartbeatAt, now)
    ? "polling"
    : null;
}
