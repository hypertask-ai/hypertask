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

export const availableThemeOptions = (roundedEnabled: boolean, graphite2Enabled: boolean) =>
  graphite2Enabled
    ? [
        { title: "Light", value: "porcelain" as const },
        { title: "AMOLED", value: "amoled" as const },
        { title: "Graphite 2", value: "graphite-2" as const },
      ]
    : themeOptions.filter(({ value }) => value !== "graphite-2" && (value !== "rounded" || roundedEnabled));

const themePreferences = new Set<string>(themeOptions.map(({ value }) => value));

export const normalizeThemePreference = (
  theme?: string,
  roundedEnabled = false,
  graphite2Enabled = true,
): ThemePreference | undefined => {
  if (graphite2Enabled) {
    if (theme === "dark" || theme === "graphite") return "graphite-2";
    if (theme === "dia" || theme === "light") return "porcelain";
    if (theme === "rounded") return "system";
  } else {
    if (theme === "rounded" && !roundedEnabled) return "system";
    if (theme === "graphite-2") return "system";
    if (theme === "dark") return "graphite";
    if (theme === "light") return "porcelain";
  }
  return theme && themePreferences.has(theme) ? theme as ThemePreference : undefined;
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
