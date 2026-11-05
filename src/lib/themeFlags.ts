import { HTPR_8710_RESTORE_THEMES_FLAG } from "@/lib/flags/definitions/htpr-8710-restore-themes";
import { HTPR_8710_THEME_SYSTEM_FLAG } from "@/lib/flags/definitions/htpr-8710-theme-system";
import { HTPR_8710_THEME_PORCELAIN_FLAG } from "@/lib/flags/definitions/htpr-8710-theme-porcelain";
import { HTPR_8710_THEME_GRAPHITE_FLAG } from "@/lib/flags/definitions/htpr-8710-theme-graphite";
import { HTPR_8710_THEME_AMOLED_FLAG } from "@/lib/flags/definitions/htpr-8710-theme-amoled";
import { HTPR_8710_THEME_DIA_FLAG } from "@/lib/flags/definitions/htpr-8710-theme-dia";

export const themeFlagKeys = {
  system: HTPR_8710_THEME_SYSTEM_FLAG,
  porcelain: HTPR_8710_THEME_PORCELAIN_FLAG,
  graphite: HTPR_8710_THEME_GRAPHITE_FLAG,
  amoled: HTPR_8710_THEME_AMOLED_FLAG,
  dia: HTPR_8710_THEME_DIA_FLAG,
} as const;

export { HTPR_8710_RESTORE_THEMES_FLAG };
