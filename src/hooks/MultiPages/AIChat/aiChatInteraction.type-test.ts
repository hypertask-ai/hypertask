import type { AiChatInteractionState } from "./aiChatInteraction";

// @ts-expect-error streaming requires sessionId, assistantMessageId, and requestId
const streamingWithoutReply: AiChatInteractionState = { phase: "streaming", recording: false };

const streamingReply: AiChatInteractionState = {
  phase: "streaming",
  recording: false,
  sessionId: "chat",
  assistantMessageId: "reply",
  requestId: "request",
};

void streamingWithoutReply;
void streamingReply;
