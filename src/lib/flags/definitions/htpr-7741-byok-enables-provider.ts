import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7741_BYOK_ENABLES_PROVIDER_FLAG = "htpr-7741-byok-enables-provider";

export default {
  key: HTPR_7741_BYOK_ENABLES_PROVIDER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Saving or enabling a provider's own API key also enables its models for the team, so chat does not silently switch to another provider. Off keeps the two settings separate for future key changes.",
  releaseRisk: {
    risk: "small",
    reason: "Only a saved, enabled provider key enables its matching models, in the existing locked transaction. Owner permissions, paid-plan checks and GDPR safe mode remain enforced; gateway and custom keys do not enable unrelated providers.",
  },
} as const satisfies FeatureFlagDefinition;
