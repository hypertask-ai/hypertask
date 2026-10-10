import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7008_PHONE_FIRST_LOAD_JS_FLAG = "htpr-7008-phone-first-load-js";

export default {
  key: HTPR_7008_PHONE_FIRST_LOAD_JS_FLAG,
  shippedOn: "2026-10-08",
  description: "Defers early warming of inbox comment parsing and closed reminder dialogs on phones until needed; Off warms those modules early.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
