import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7004_NO_LOADING_FLASH_FLAG = "htpr-7004-no-loading-flash";

export default {
  key: HTPR_7004_NO_LOADING_FLASH_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-08",
  description: "Keeps an already-visible cached ticket on screen while retrying a failed background refresh instead of reloading into Loading after Back.",
} as const satisfies FeatureFlagDefinition;
