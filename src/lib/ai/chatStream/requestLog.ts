import { createLogger } from "evlog";

import { buildAiChatRequestEvent, type AiChatRequestLogInput } from "./requestLogEvent";

const SERVICE = "hypertask-ai-chat";
const EVENT = "ai_chat_request";

export function writeAiChatRequestLog(input: AiChatRequestLogInput) {
  try {
    const log = createLogger({
      service: SERVICE,
      event: EVENT,
      ...buildAiChatRequestEvent(input),
    });
    if (input.outcome === "failed") log.setLevel("error");
    log.emit({ _durationMs: input.durationMs });
  } catch (error) {
    console.warn("[ai/chat/stream] request log failed", error);
  }
}
