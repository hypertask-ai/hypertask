import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";
import nookies from "nookies";
import { useEffect, useState } from "react";
import {
  nextThemeForDarkModeToggle,
  normalizeThemePreference,
  resolveThemePreference,
  type ThemePreference,
} from "@/lib/themePreferences";

const useDarkMode = () => {
  const router = useRouter();
  const cookies = parseCookies();
  const cookieTheme = normalizeThemePreference(cookies.theme);

  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      setSystemTheme(match.matches ? "dark" : "light");
    };
    const onSystemChange = () => {
      syncSystemTheme();
      // Re-fetch RSC only when SSR must re-read the theme cookie (system mode)
      if (parseCookies().theme === "system") {
        router.refresh();
      }
    };

    syncSystemTheme();
    match.addEventListener("change", onSystemChange);
    return () => match.removeEventListener("change", onSystemChange);
  }, [router]);

  const resolvedTheme = resolveThemePreference(cookieTheme, systemTheme);
  const effectiveTheme =
    resolvedTheme === "amoled" || resolvedTheme === "graphite"
      ? "dark"
      : "light";

  const setTheme = (theme: ThemePreference) => {
    nookies.set(null, "theme", theme, {
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
