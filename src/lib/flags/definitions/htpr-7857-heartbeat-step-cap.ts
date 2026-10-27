import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7857_HEARTBEAT_STEP_CAP_FLAG = "htpr-7857-heartbeat-step-cap";

export default {
  key: HTPR_7857_HEARTBEAT_STEP_CAP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Limits automatic native agent heartbeat turns to four completed AI steps, including empty-response retries. User-requested chats keep their existing budget.",
  releaseRisk: {
    risk: "small",
    reason: "Only caps automatic heartbeat work per turn; permissions, tools, billing and user-requested chat limits stay unchanged. Switching off restores the previous budget.",
  },
} as const satisfies FeatureFlagDefinition;
