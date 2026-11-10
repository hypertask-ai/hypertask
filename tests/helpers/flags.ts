import type { FeatureFlagDefinition } from "../../src/lib/flags/definitions";

const { definitions } = require("./flag-files.cjs") as { definitions: () => FeatureFlagDefinition[] };

export type FlagOverrides = Partial<Record<string, Partial<FeatureFlagDefinition>>>;

export function stubFlags(overrides: FlagOverrides = {}) {
  const real = definitions();
  const unknown = Object.keys(overrides).filter((key) => !real.some((definition) => definition.key === key));
  if (unknown.length > 0) {
    throw new Error(
      `stubFlags: ${unknown.join(", ")} is not a flag in src/lib/flags/definitions. Use a registered key, so a renamed or retired flag fails here instead of passing a stale test.`,
    );
  }
  return {
    FEATURE_FLAG_DEFINITIONS: real.map((definition) => {
      const override = overrides[definition.key];
      return override ? { ...definition, ...override } : definition;
    }),
  };
}
