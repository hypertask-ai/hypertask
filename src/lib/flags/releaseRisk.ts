import { FLAG_DEFINITIONS } from "./definitions/index.generated";

export const RELEASE_RISK_REQUIRED_FROM = "2026-10-11";

export type FeatureFlagReleaseRisk = {
  risk: "none" | "small" | "new";
  reason: string;
  highRisk?: "money" | "access" | "data-deletion" | "customer-email";
};

export const HIGH_RISK_CATEGORIES = ["money", "access", "data-deletion", "customer-email"] as const;
export const HIGH_RISK_LABELS: Record<NonNullable<FeatureFlagReleaseRisk["highRisk"]>, string> = {
  money: "Money",
  access: "Login and access",
  "data-deletion": "Data deletion",
  "customer-email": "Customer emails",
};

export const RELEASE_RISK_LABELS: Record<FeatureFlagReleaseRisk["risk"], string> = {
  none: "No visible change",
  small: "Small change",
  new: "New feature",
};
export const RELEASE_RISK_ORDER: FeatureFlagReleaseRisk["risk"][] = ["none", "small", "new"];

export const FEATURE_FLAG_RELEASE_RISKS: Partial<Record<string, FeatureFlagReleaseRisk>> = Object.fromEntries(
  FLAG_DEFINITIONS.flatMap((definition) => "releaseRisk" in definition ? [[definition.key, definition.releaseRisk]] : []),
);
