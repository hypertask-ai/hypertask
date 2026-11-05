import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8710_RESTORE_THEMES_FLAG, themeFlagKeys } from "@/lib/themeFlags";

export async function readThemeVisibility(userId: number) {
  const restore = await isFeatureEnabled(HTPR_8710_RESTORE_THEMES_FLAG, userId);
  const [system, porcelain, graphite, amoled, dia] = restore
    ? await Promise.all([
        isFeatureEnabled(themeFlagKeys.system, userId),
        isFeatureEnabled(themeFlagKeys.porcelain, userId),
        isFeatureEnabled(themeFlagKeys.graphite, userId),
        isFeatureEnabled(themeFlagKeys.amoled, userId),
        isFeatureEnabled(themeFlagKeys.dia, userId),
      ])
    : [false, false, false, false, false];
  return { restore, loaded: true, system, porcelain, graphite, amoled, dia };
}
