import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6112_COPY_CURRENT_URL_FLAG = "htpr-6112-copy-current-url";

export default {
  key: HTPR_6112_COPY_CURRENT_URL_FLAG,
  shippedOn: "2026-09-04",
  description: "Adds a Copy current URL action to the command menu.",
} as const satisfies FeatureFlagDefinition;
