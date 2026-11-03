import type { FeatureFlagKind } from "./definitions";

export const INTERNAL_FLAG_KIND: FeatureFlagKind = "internal";

export function withoutInternalFlags<T extends { kind?: FeatureFlagKind }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.kind !== INTERNAL_FLAG_KIND);
}
