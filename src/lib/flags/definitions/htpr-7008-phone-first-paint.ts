import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7008_PHONE_FIRST_PAINT_FLAG = "htpr-7008-phone-first-paint";

export default {
  key: HTPR_7008_PHONE_FIRST_PAINT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-08",
  description: "Defers automatic ticket editor, reactions, emoji and Firebase warming on phone board and inbox pages until user interaction.",
} as const satisfies FeatureFlagDefinition;
