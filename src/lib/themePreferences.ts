export const themeOptions = [
  { title: "Follow system", value: "system" },
  { title: "Light · Porcelain", value: "porcelain" },
  { title: "Dark · Graphite", value: "graphite" },
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
  amoled: { classes: ["dark", "amoled"], themeColor: "#000000" },
  dia: { classes: ["light", "dia"], themeColor: "#f6f4ef" },
  "rounded-light": { classes: ["light", "rounded", "rounded-light"], themeColor: "#fcfcfc" },
  "rounded-dark": { classes: ["dark", "rounded", "rounded-dark"], themeColor: "#000000" },
};

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

const themePreferences = new Set<ThemePreference>(
  themeOptions.map(({ value }) => value),
);

export const normalizeThemePreference = (
  theme?: string,
  roundedEnabled = false,
): ThemePreference | undefined => {
  if (theme === "rounded" && !roundedEnabled) return "system";
  const normalized =
    theme === "dark" ? "graphite" : theme === "light" ? "porcelain" : theme;

  return themePreferences.has(normalized as ThemePreference)
    ? (normalized as ThemePreference)
    : undefined;
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
