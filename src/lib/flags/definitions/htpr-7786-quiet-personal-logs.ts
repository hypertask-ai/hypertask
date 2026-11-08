import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7786_QUIET_PERSONAL_LOGS_FLAG = "htpr-7786-quiet-personal-logs";

export default {
  key: HTPR_7786_QUIET_PERSONAL_LOGS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "Server logs for task writes, sign-in, billing, invites and push keep record ids and emails, and leave out request bodies, display names and device tokens.",
  releaseRisk: {
    risk: "small",
    reason: "Only those log lines change. Sign-in, billing, invites and stored emails stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
