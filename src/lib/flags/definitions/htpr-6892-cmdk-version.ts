import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6892_CMDK_VERSION_FLAG = "htpr-6892-cmdk-version";

export default {
  key: HTPR_6892_CMDK_VERSION_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description:
    "Shows the build loaded by this tab at the bottom of the desktop Ctrl+K command center, with its commit and local build time.",
} as const satisfies FeatureFlagDefinition;
