import type { FeatureFlagDefinition } from "../definitions";

export const YPER4_801_MANAGER_LEASE_FLAG_SWITCH_FLAG = "yper4-801-manager-lease-flag-switch";

export default {
  key: YPER4_801_MANAGER_LEASE_FLAG_SWITCH_FLAG,
  kind: "feature",
  defaultMode: "OFF",
  shippedOn: "2026-10-26",
  description: "Manager agents must show proof of the current manager lease before they can switch a feature flag; former managers are refused.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Refuses flag switches from manager agents without current lease proof and fails closed when the lease registry cannot be read. Off restores the existing approval checks only.",
  },
} as const satisfies FeatureFlagDefinition;
