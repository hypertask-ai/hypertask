import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7050_CTRL_O_LINKS_FLAG = "htpr-7050-ctrl-o-links";

export default {
  key: HTPR_7050_CTRL_O_LINKS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Lists saved description and comment links, related URLs and attachments in the ticket Ctrl+O menu even when legacy URL copies are missing.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing Ctrl+O menu lists saved ticket links and attachments that were previously missing."
  },
} as const satisfies FeatureFlagDefinition;
