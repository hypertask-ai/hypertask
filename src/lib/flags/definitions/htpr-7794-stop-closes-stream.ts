import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7794_STOP_CLOSES_STREAM_FLAG = "htpr-7794-stop-closes-stream";

export default {
  key: HTPR_7794_STOP_CLOSES_STREAM_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Closes stopped AI chat replies and releases Send after Stop is acknowledged, without reloading the page.",
  releaseRisk: { risk: "small", reason: "Finishes cancelled replies using the existing terminal event and isolates client cleanup to the send that owns it; disconnects still run in the background." },
} as const satisfies FeatureFlagDefinition;
