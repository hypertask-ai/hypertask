import { useMemo } from "react";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import { HTPR_8710_RESTORE_THEMES_FLAG, themeFlagKeys } from "@/lib/themeFlags";

export function useThemeVisibility() {
  const restore = useFlag(HTPR_8710_RESTORE_THEMES_FLAG);
  const restoreLoaded = useFlagLoaded(HTPR_8710_RESTORE_THEMES_FLAG);
  const system = useFlag(themeFlagKeys.system);
  const porcelain = useFlag(themeFlagKeys.porcelain);
  const graphite = useFlag(themeFlagKeys.graphite);
  const amoled = useFlag(themeFlagKeys.amoled);
  const dia = useFlag(themeFlagKeys.dia);
  const systemLoaded = useFlagLoaded(themeFlagKeys.system);
  const porcelainLoaded = useFlagLoaded(themeFlagKeys.porcelain);
  const graphiteLoaded = useFlagLoaded(themeFlagKeys.graphite);
  const amoledLoaded = useFlagLoaded(themeFlagKeys.amoled);
  const diaLoaded = useFlagLoaded(themeFlagKeys.dia);
  const loaded = restoreLoaded && (!restore || (systemLoaded && porcelainLoaded && graphiteLoaded && amoledLoaded && diaLoaded));
  return useMemo(() => ({ restore, loaded, system, porcelain, graphite, amoled, dia }), [restore, loaded, system, porcelain, graphite, amoled, dia]);
}
