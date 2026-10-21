import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7267_SHORTCUT_TIPS_SETTING_FLAG = "htpr-7267-shortcut-tips-setting";

export default {
  key: HTPR_7267_SHORTCUT_TIPS_SETTING_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-16",
  description: "The shortcut tip after three mouse archives uses its own on/off setting instead of the bottom quick-tips bar, which inbox zero and its close button hide.",
  releaseRisk: { risk: "small", reason: "Only changes which saved setting decides whether the Owner + QA shortcut tip may show; flag Off restores the quick-tips bar setting." },
} as const satisfies FeatureFlagDefinition;
