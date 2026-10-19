"use client";

import { useEffect } from "react";
import { useFlag, useFlagLoaded } from "@/hooks/useFlag";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/keys";
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

      const root = document.documentElement;
      const wanted = resolvedThemeDomMetadata[resolved].classes;
      const themeClasses = new Set(["system", ...Object.values(resolvedThemeDomMetadata).flatMap(({ classes }) => classes)]);
      const present = [...root.classList].filter((name) => themeClasses.has(name));
      const alreadyApplied =
        root.getAttribute("data-theme") === resolved &&
        present.length === wanted.length &&
        wanted.every((name) => root.classList.contains(name));
      if (alreadyApplied) return;

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
    const serverRenderedThemeObserver = new MutationObserver(applyTheme);
    serverRenderedThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      match.removeEventListener("change", applyTheme);
      serverRenderedThemeObserver.disconnect();
    };
  }, [roundedEnabled, roundedLoaded]);

  return null;
};

export default ThemeListener;
