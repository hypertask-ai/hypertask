import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG = "htpr-8742-attachment-download-hint";

export default {
  key: HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "A task's attachments name the authenticated download request. Off leaves fileSource with no download instructions.",
  releaseRisk: {
    risk: "small",
    reason: "Adds a download string on attachment rows returned to agents. fileSource stays. Off omits the string.",
  },
} as const satisfies FeatureFlagDefinition;
