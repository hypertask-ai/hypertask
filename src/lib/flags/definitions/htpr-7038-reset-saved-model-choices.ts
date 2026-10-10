import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7038_RESET_SAVED_MODEL_CHOICES_FLAG = "htpr-7038-reset-saved-model-choices";

export default {
  key: HTPR_7038_RESET_SAVED_MODEL_CHOICES_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Resets saved personal text-model choices to Haiku 5.5 once per enabled user, preserving backups and later choices.",
} as const satisfies FeatureFlagDefinition;
