import type { FeatureFlagMode } from "@prisma/client";
import type { FeatureFlagReleaseRisk } from "./releaseRisk";
import { FLAG_DEFINITIONS } from "./definitions/index.generated";

export type FeatureFlagKind = "feature" | "bugfix" | "improvement";
export type FeatureFlagDefinition = {
  key: string;
  kind?: FeatureFlagKind;
  // An explicit mode wins over kind when no row is saved.
  defaultMode?: FeatureFlagMode;
  description: string;
  // Calendar day the key first reached production, corrected after merging if needed.
  shippedOn: string;
  related?: readonly string[];
  releaseRisk?: FeatureFlagReleaseRisk;
};

export const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;
