import { FLAG_DEFINITIONS } from "./definitions/index.generated";

export const RELEASE_RISK_REQUIRED_FROM = "2026-10-11";

export type FeatureFlagReleaseRisk = {
  risk: "none" | "small" | "new";
  reason: string;
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
