import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8960_BORDER_ONLY_SELECT_FLAG = "htpr-8960-border-only-select";

export default {
  key: HTPR_8960_BORDER_ONLY_SELECT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Board cards select by blue border only: no checkbox, Shift+click or X starts selecting, and a plain click toggles while cards are selected.",
  releaseRisk: {
    risk: "small",
    reason: "Changes how board cards are selected without touching saved data. Off restores the checkbox.",
  },
} as const satisfies FeatureFlagDefinition;
