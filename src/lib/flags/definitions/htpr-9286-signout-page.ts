import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9286_SIGNOUT_PAGE_FLAG = "htpr-9286-signout-page";

export default {
  key: HTPR_9286_SIGNOUT_PAGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "Adds a sign-out page at /signout. Opening it signs you out of Hypertask in this browser and offers Sign in again, which shows Google's account chooser.",
  related: ["htpr-7799-project-entry"],
  releaseRisk: {
    risk: "small",
    reason:
      "A new page only. With the switch off, /signout is not found and every existing sign-out path is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
