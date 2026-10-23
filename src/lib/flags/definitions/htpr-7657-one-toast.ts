import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7657_ONE_TOAST_FLAG = "htpr-7657-one-toast";

export default {
  key: HTPR_7657_ONE_TOAST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Only one toast shows at a time: a newer message replaces the older one, and an undo toast closes any other toast so the two never overlap.",
  releaseRisk: {
    risk: "small",
    reason: "Only dismisses toasts that were already on screen behind a newer one or behind an undo toast; no toast content, timing or undo action changes. Off restores stacked toasts.",
  },
} as const satisfies FeatureFlagDefinition;
