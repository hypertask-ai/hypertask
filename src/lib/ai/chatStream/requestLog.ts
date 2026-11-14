import { buildAiChatRequestEvent, type AiChatRequestLogInput } from "./requestLogEvent";

const SERVICE = "hypertask-ai-chat";
const EVENT = "ai_chat_request";

let loggerReady = false;

export async function writeAiChatRequestLog(input: AiChatRequestLogInput) {
  try {
    const { createLogger, initLogger } = await import("evlog");
    if (!loggerReady) {
      initLogger({
        stringify: true,
        pretty: false,
        redact: true,
        env: { service: SERVICE },
      });
      loggerReady = true;
    }
    const log = createLogger({
      service: SERVICE,
      event: EVENT,
      ...buildAiChatRequestEvent(input),
    });
    if (input.outcome === "failed") log.setLevel("error");
    log.emit({ _durationMs: input.durationMs, _forceKeep: true });
  } catch (error) {
    console.warn("[ai/chat/stream] request log failed", error);
  }
}
