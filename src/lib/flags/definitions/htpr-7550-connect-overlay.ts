import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7550_CONNECT_OVERLAY_FLAG = "htpr-7550-connect-overlay";

export default {
  key: HTPR_7550_CONNECT_OVERLAY_FLAG,
  kind: "feature",
  defaultMode: "OWNER_ONLY",
  shippedOn: "2026-10-22",
  releaseRisk: {
    risk: "new",
    reason: "Shows the existing agent picker in a modal before the first-task pointer; no signup, access, billing or email changes.",
    ownerRequest: {
      quote: "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
    },
  },
  description: "Shows the connect-agent overlay on the first enrolled starter board before the first-task pointer. Owner-only preview requested by Valentin on HTPR-7511; no high-risk changes.",
} as const satisfies FeatureFlagDefinition;
