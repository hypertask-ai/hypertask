import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8863_EVLOG_CHAT_LOG_FLAG = "htpr-8863-evlog-chat-log";

export default {
  key: HTPR_8863_EVLOG_CHAT_LOG_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Writes one structured log line per AI chat request, with the model, the outcome, the duration and, on a failure, the reason and the next step.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one extra log line per AI chat turn and changes nothing a person sees. Logging is guarded, never awaited by the reply, and carries no prompt text or keys, so Off returns to today's logs.",
  },
} as const satisfies FeatureFlagDefinition;
