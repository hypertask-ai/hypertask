import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7691_IDEMPOTENT_ARCHIVE_FLAG = "htpr-7691-idempotent-archive";

export default {
  key: HTPR_7691_IDEMPOTENT_ARCHIVE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-23",
  defaultMode: "EVERYONE",
  description: "On makes archiving an Inbox message always archive it: archiving one that is already archived leaves it archived. Undo still puts it back. Off restores the old toggle, where a second archive brought the message back.",
  releaseRisk: {
    risk: "small",
    reason: "Only archive requests that say they mean archive change; Undo and every other caller keep the toggle.",
  },
} as const satisfies FeatureFlagDefinition;
