import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7887_VALIDATION_REFUSALS_FLAG = "htpr-7887-validation-refusals";

export default {
  key: HTPR_7887_VALIDATION_REFUSALS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "An automatic 400 validation refusal files no Bugs ticket until three distinct reporters inside 24 hours escalate it.",
  releaseRisk: { risk: "small", reason: "Feedback filing only; validation responses and access rules are unchanged. Off restores immediate filing. Ticket HTPR-7887: https://app.hypertask.ai/detail/project-15/7887" },
} as const satisfies FeatureFlagDefinition;
