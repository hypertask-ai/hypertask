import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG = "htpr-4228-admin-only-time-reports";

export default {
  key: HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
  shippedOn: "2026-09-09",
  description:
    "In time reports, plain board members see only their own logged time; board owners and admins still see everyone's entries and keep the user filter.",
} as const satisfies FeatureFlagDefinition;
