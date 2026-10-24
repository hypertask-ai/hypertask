import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7718_FIRST_VISIT_FLAG_SEED_FLAG = "htpr-7718-first-visit-flag-seed";

export default {
  key: HTPR_7718_FIRST_VISIT_FLAG_SEED_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description: "On a first visit without saved board settings, the app starts with your feature switches already applied, so the board draws real cards first instead of grey placeholders.",
  releaseRisk: {
    risk: "small",
    reason: "Only seeds the signed-in account's evaluated flags when no board or ticket seed exists; Off restores fetching flags after the first render.",
  },
} as const satisfies FeatureFlagDefinition;
