import type { FeatureFlagMode } from "@prisma/client";
import type { FeatureFlagReleaseRisk } from "./releaseRisk";
import { FLAG_DEFINITIONS } from "./definitions/index.generated";

export type FeatureFlagKind = "feature" | "bugfix" | "improvement";
export type FeatureFlagDefinition = {
  key: string;
  kind?: FeatureFlagKind;
  defaultMode?: FeatureFlagMode;
  description: string;
  shippedOn: string;
  related?: readonly string[];
  releaseRisk?: FeatureFlagReleaseRisk;
};

export const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;
