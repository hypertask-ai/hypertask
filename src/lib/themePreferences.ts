export const themeOptions = [
  { title: "Follow system", value: "system" },
  { title: "Light · Porcelain", value: "porcelain" },
  { title: "Dark · Graphite", value: "graphite" },
  { title: "Graphite 2", value: "graphite-2" },
  { title: "OLED black · AMOLED", value: "amoled" },
  { title: "Paper · Dia", value: "dia" },
  { title: "Material (follows device)", value: "rounded" },
] as const;

export type ThemePreference = (typeof themeOptions)[number]["value"];
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

export type LegacyTheme = "system" | "porcelain" | "graphite" | "amoled" | "dia";
export type ThemeVisibility = { restore: boolean; loaded: boolean } & Partial<Record<LegacyTheme, boolean>>;

export const availableThemeOptions = (roundedEnabled: boolean, graphite2Enabled: boolean, visibility?: ThemeVisibility) =>
  visibility && !visibility.loaded ? [] : themeOptions.filter(({ value }) => {
    if (value === "rounded") return roundedEnabled;
    if (value === "graphite-2") return graphite2Enabled;
    return !visibility?.restore || visibility[value] !== false;
  });

const themePreferences = new Set<string>(themeOptions.map(({ value }) => value));

export const normalizeThemePreference = (
  theme?: string,
  roundedEnabled = false,
  graphite2Enabled = true,
  _restore = false,
): ThemePreference | undefined => {
  if (theme === "dark") return "graphite";
  if (theme === "light") return "porcelain";
  if (theme === "rounded" && !roundedEnabled) return "system";
  if (theme === "graphite-2" && !graphite2Enabled) return "system";
  return theme && themePreferences.has(theme) ? theme as ThemePreference : undefined;
};

export const availableThemePreference = (
  theme: ThemePreference | undefined,
  roundedEnabled: boolean,
  graphite2Enabled: boolean,
  visibility?: ThemeVisibility,
): ThemePreference => {
  if (!visibility?.restore) return theme ?? "system";
  return theme && availableThemeOptions(roundedEnabled, graphite2Enabled, visibility)
    .some((option) => option.value === theme) ? theme : "system";
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
