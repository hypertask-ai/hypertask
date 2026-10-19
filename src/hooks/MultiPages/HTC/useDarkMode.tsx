import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import nookies from "nookies";
import { useEffect, useState } from "react";
import {
  nextThemeForDarkModeToggle,
  normalizeThemePreference,
  resolveThemePreference,
  resolvedThemeDomMetadata,
  type ThemePreference,
} from "@/lib/themePreferences";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/keys";

const useDarkMode = () => {
  const roundedEnabled = useFlag(HTPR_7328_ROUNDED_THEME_FLAG);
  const router = useRouter();
  const cookies = parseCookies();
  const cookieTheme = roundedEnabled
    ? normalizeThemePreference(cookies.theme, true)
    : normalizeThemePreference(cookies.theme);

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

  const resolvedTheme = resolveThemePreference(cookieTheme, systemTheme);
  const effectiveTheme =
    resolvedThemeDomMetadata[resolvedTheme].classes.includes("dark")
      ? "dark"
      : "light";

  const setTheme = (theme: ThemePreference) => {
    nookies.set(null, "theme", normalizeThemePreference(theme, roundedEnabled) ?? "system", {
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
    router.refresh();
  };

  const toggleDarkModeHandler = () => {
    setTheme(nextThemeForDarkModeToggle(effectiveTheme));
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
