export const themeOptions = [
  { title: "Follow system", value: "system" },
  { title: "Light · Porcelain", value: "porcelain" },
  { title: "Dark · Graphite", value: "graphite" },
  { title: "OLED black · AMOLED", value: "amoled" },
  { title: "Paper · Dia", value: "dia" },
] as const;

export type ThemePreference = (typeof themeOptions)[number]["value"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type SystemColorScheme = "light" | "dark";

export const resolvedThemeDomMetadata: Record<
  ResolvedTheme,
  { classes: readonly string[]; themeColor: string }
> = {
  porcelain: { classes: ["light", "porcelain"], themeColor: "#ffffff" },
  graphite: { classes: ["dark", "graphite"], themeColor: "#232326" },
  amoled: { classes: ["dark", "amoled"], themeColor: "#000000" },
  dia: { classes: ["light", "dia"], themeColor: "#f6f4ef" },
};

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

const themePreferences = new Set<ThemePreference>(
  themeOptions.map(({ value }) => value),
);

// The retired light/dark cookie values remain valid inputs so existing users
// keep their saved preference after the palette labels change.
export const normalizeThemePreference = (
  theme?: string,
): ThemePreference | undefined => {
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

  return theme;
};

// Installed PWAs keep the initial document color for their native title bar.
// Prefer dark until the pre-paint script can resolve an unpinned system theme.
export const resolveInitialThemeColor = (
  theme: ThemePreference | undefined,
): string =>
  resolvedThemeDomMetadata[resolveThemePreference(theme, "dark")].themeColor;
