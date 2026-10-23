const AGENT_MESSAGE_PREFIX = "\u001eht-agent-message:v1:";
const UUID_LENGTH = 36;

export const agentMessageMarker = (assistantMessageId: string) =>
  `${AGENT_MESSAGE_PREFIX}${assistantMessageId}:`;

export const encodeAgentMessage = (
  assistantMessageId: string,
  content: string,
) => `${agentMessageMarker(assistantMessageId)}${content}`;

export const decodeAgentMessage = (message: string | null | undefined) => {
  if (!message?.startsWith(AGENT_MESSAGE_PREFIX)) return message ?? "";
  const contentOffset = AGENT_MESSAGE_PREFIX.length + UUID_LENGTH;
  if (message[contentOffset] !== ":") return message;
  return message.slice(contentOffset + 1);
};
