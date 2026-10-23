import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG = "htpr-7512-attach-keeps-comment";

export default {
  key: HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description: "Keeps agent posts with attachment intent as comments so files can be uploaded to them.",
  releaseRisk: {
    risk: "small",
    reason: "Only explicit attachment intent bypasses agent-log routing; existing comment and image handling stays unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
