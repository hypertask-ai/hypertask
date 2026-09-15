export const AGENT_CHAT_HEARTBEAT_MAX_AGE_MS = 60_000;

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

export function isAgentChatEnabled(
  availability: ChatAvailability,
  now = new Date(),
): boolean {
  return (
    hasFreshAgentChatHeartbeat(availability.heartbeatAt, now) ||
    Boolean(
      availability.subscription?.active &&
        availability.subscription.events.includes("chat.message"),
    )
  );
}
