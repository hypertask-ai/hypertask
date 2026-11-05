import { HTPR_8054_GRAPHITE_2_FLAG } from "@/lib/flags/definitions/htpr-8054-graphite-2";
import { useThemeVisibility } from "@/hooks/useThemeVisibility";
import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import nookies from "nookies";
import { useEffect, useState } from "react";
import {
  nextThemeForDarkModeToggle,
  normalizeThemePreference,
  availableThemePreference,
  availableThemeOptions,
  resolveThemePreference,
  resolvedThemeDomMetadata,
  type ThemePreference,
} from "@/lib/themePreferences";

import { useFlag } from "@/hooks/useFlag";
import { useMobileView } from "@/lib/contexts/mobileContext";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/keys";

const useDarkMode = () => {
  const visibility = useThemeVisibility();
  const roundedEnabled = useFlag(HTPR_7328_ROUNDED_THEME_FLAG);
  const graphite2Enabled = useFlag(HTPR_8054_GRAPHITE_2_FLAG);
  const isMobile = useMobileView();
  const router = useRouter();
  const cookies = parseCookies();
  const cookieTheme = normalizeThemePreference(cookies.theme, roundedEnabled, graphite2Enabled, visibility.restore);

  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      setSystemTheme(match.matches ? "dark" : "light");
    };
    const onSystemChange = () => {
      syncSystemTheme();
      if (["system", "rounded"].includes(parseCookies().theme)) {
        router.refresh();
      }
    };

    syncSystemTheme();
    match.addEventListener("change", onSystemChange);
    return () => match.removeEventListener("change", onSystemChange);
  }, [router]);

  const resolvedTheme = resolveThemePreference(
    cookieTheme === "rounded" && isMobile ? "system" : visibility.restore ? availableThemePreference(cookieTheme, roundedEnabled, graphite2Enabled, visibility) : cookieTheme,
    systemTheme,
  );
  const effectiveTheme =
    resolvedThemeDomMetadata[resolvedTheme].classes.includes("dark")
      ? "dark"
      : "light";

  const setTheme = (theme: ThemePreference) => {
    if (!visibility.loaded || (visibility.restore && !availableThemeOptions(roundedEnabled && !isMobile, graphite2Enabled, visibility).some((option) => option.value === theme))) return;
    nookies.set(null, "theme", normalizeThemePreference(theme, roundedEnabled, graphite2Enabled, visibility.restore) ?? "system", {
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
    router.refresh();
  };

  const toggleDarkModeHandler = () => {
    const preferred = nextThemeForDarkModeToggle(effectiveTheme);
    if (!visibility.restore) {
      setTheme(preferred);
      return;
    }
    const options = availableThemeOptions(roundedEnabled && !isMobile, graphite2Enabled, visibility);
    const opposite = (theme: ThemePreference) =>
      resolvedThemeDomMetadata[resolveThemePreference(theme, systemTheme)].classes.includes("dark") !== (effectiveTheme === "dark");
    const next = options.find((option) => option.value === preferred && opposite(option.value))
      ?? options.find((option) => opposite(option.value));
    if (next) setTheme(next.value);
  };

  const switchToTheme = (theme: ThemePreference) => setTheme(theme);

  return {
    currentTheme: cookieTheme,
    effectiveTheme,
    toggleDarkModeHandler,
    switchToTheme,
  };
};
export default useDarkMode;
