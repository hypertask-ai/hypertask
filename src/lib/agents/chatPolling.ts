export const AGENT_CHAT_POLL_HEARTBEAT_TTL_MS = 2 * 60 * 1000;

export function isAgentChatPollingActive(
  heartbeatAt: Date | null | undefined,
  now = new Date(),
): boolean {
  return (
    heartbeatAt instanceof Date &&
    now.getTime() - heartbeatAt.getTime() <= AGENT_CHAT_POLL_HEARTBEAT_TTL_MS
  );
}
