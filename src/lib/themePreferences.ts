export const themeOptions = [
  { title: "Light", value: "porcelain" },
  { title: "AMOLED", value: "amoled" },
  { title: "Graphite 2", value: "graphite-2" },
] as const;

export type ThemePreference = (typeof themeOptions)[number]["value"] | "system" | "graphite" | "dia" | "rounded";
export type ResolvedTheme = Exclude<ThemePreference, "system" | "rounded"> | "rounded-light" | "rounded-dark";
export type SystemColorScheme = "light" | "dark";

export const resolvedThemeDomMetadata: Record<
  ResolvedTheme,
  { classes: readonly string[]; themeColor: string }
> = {
  porcelain: { classes: ["light", "porcelain"], themeColor: "#ffffff" },
  graphite: { classes: ["dark", "graphite"], themeColor: "#232326" },
  "graphite-2": { classes: ["dark", "graphite-2"], themeColor: "#17181b" },
  amoled: { classes: ["dark", "amoled"], themeColor: "#000000" },
  dia: { classes: ["light", "dia"], themeColor: "#f6f4ef" },
  "rounded-light": { classes: ["light", "rounded", "rounded-light"], themeColor: "#fcfcfc" },
  "rounded-dark": { classes: ["dark", "rounded", "rounded-dark"], themeColor: "#000000" },
};

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const legacyThemePreferences: Record<string, ThemePreference> = {
  light: "porcelain",
  dark: "graphite-2",
  graphite: "graphite-2",
  dia: "porcelain",
  rounded: "system",
};

const themePreferences = new Set<string>(["system", ...themeOptions.map(({ value }) => value)]);

export const normalizeThemePreference = (
  theme?: string,
  _roundedEnabled = false,
  graphite2Enabled = true,
): ThemePreference | undefined => {
  if (!theme) return undefined;
  const normalized = Object.hasOwn(legacyThemePreferences, theme) ? legacyThemePreferences[theme] : theme;
  if (normalized === "graphite-2" && !graphite2Enabled) return theme === "graphite-2" ? "system" : "amoled";
  return themePreferences.has(normalized) ? normalized as ThemePreference : undefined;
};

export const themeCookieSeedValue = (
  theme?: string,
): ThemePreference | undefined =>
  normalizeThemePreference(theme) ? undefined : DEFAULT_THEME_PREFERENCE;

export const nextThemeForDarkModeToggle = (
  effectiveTheme: "dark" | "light",
): ThemePreference => (effectiveTheme === "dark" ? "porcelain" : "amoled");

export const resolveThemePreference = (
  theme: ThemePreference | undefined,
  systemColorScheme: SystemColorScheme,
): ResolvedTheme => {
  if (!theme || theme === "system") {
    return systemColorScheme === "dark" ? "amoled" : "porcelain";
  }

  if (theme === "rounded") {
    return systemColorScheme === "dark" ? "rounded-dark" : "rounded-light";
  }

  return theme;
};

export const resolveInitialThemeColor = (
  theme: ThemePreference | undefined,
): string =>
  resolvedThemeDomMetadata[resolveThemePreference(theme, "dark")].themeColor;
