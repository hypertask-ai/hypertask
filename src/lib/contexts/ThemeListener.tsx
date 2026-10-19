"use client";

import { useEffect } from "react";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/definitions/htpr-7328-rounded-theme";
import {
  normalizeThemePreference,
  resolvedThemeDomMetadata,
  resolveThemePreference,
} from "@/lib/themePreferences";

const ThemeListener = () => {
  const roundedEnabled = useFlag(HTPR_7328_ROUNDED_THEME_FLAG);
  const roundedLoaded = useFlagLoaded(HTPR_7328_ROUNDED_THEME_FLAG);
  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const stored =
        document.cookie
          .split("; ")
          .find((row) => row.startsWith("theme="))
          ?.split("=")[1] || "system";

      if (stored === "rounded" && !roundedLoaded) return;
      const theme = normalizeThemePreference(stored, roundedEnabled);
      const resolved = resolveThemePreference(
        theme,
        match.matches ? "dark" : "light"
      );

      document.documentElement.classList.remove(
        "system",
        ...new Set(Object.values(resolvedThemeDomMetadata).flatMap(({ classes }) => classes)),
      );
      document.documentElement.classList.add(...resolvedThemeDomMetadata[resolved].classes);
      document.documentElement.setAttribute("data-theme", resolved);

      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          resolvedThemeDomMetadata[resolved].themeColor,
        );
    };

    applyTheme();
    match.addEventListener("change", applyTheme);

    return () => match.removeEventListener("change", applyTheme);
  }, [roundedEnabled, roundedLoaded]);

  return null;
};

export default ThemeListener;
