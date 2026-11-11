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
  pollingFallbackEnabled = false,
): AgentChatDeliveryMode {
  if (availability.subscription?.active) {
    if (availability.subscription.events?.includes("chat.message")) return "webhook";
    if (!pollingFallbackEnabled) return null;
  }
  return hasFreshAgentChatHeartbeat(availability.heartbeatAt, now)
    ? "polling"
    : null;
}

export function retainUndeliveredAgentChat(input: {
  webhookDeliveryCount: number;
  mode: AgentChatDeliveryMode;
  pollingFallbackEnabled: boolean;
  subscriptionActive: boolean;
  subscriptionHasChat: boolean;
}): boolean {
  if (input.webhookDeliveryCount > 0) return false;
  if (input.mode === "polling") return true;
  return input.pollingFallbackEnabled && (!input.subscriptionActive || !input.subscriptionHasChat);
}
