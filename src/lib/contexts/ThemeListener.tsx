"use client";

import { useEffect } from "react";
import {
  normalizeThemePreference,
  resolvedThemeDomMetadata,
  resolveThemePreference,
} from "@/lib/themePreferences";

const ThemeListener = () => {
  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const stored =
        document.cookie
          .split("; ")
          .find((row) => row.startsWith("theme="))
          ?.split("=")[1] || "system";

      const theme = normalizeThemePreference(stored);
      const resolved = resolveThemePreference(
        theme,
        match.matches ? "dark" : "light"
      );

      document.documentElement.classList.remove(
        "light",
        "dark",
        "amoled",
        "dia",
        "graphite",
        "porcelain"
      );
      if (resolved === "amoled") {
        document.documentElement.classList.add("dark", "amoled");
        document.documentElement.setAttribute("data-theme", "amoled");
      } else if (resolved === "dia") {
        document.documentElement.classList.add("light", "dia");
        document.documentElement.setAttribute("data-theme", "dia");
      } else if (resolved === "graphite") {
        document.documentElement.classList.add("dark", "graphite");
        document.documentElement.setAttribute("data-theme", "graphite");
      } else if (resolved === "porcelain") {
        document.documentElement.classList.add("light", "porcelain");
        document.documentElement.setAttribute("data-theme", "porcelain");
      } else {
        document.documentElement.classList.add(resolved);
        document.documentElement.setAttribute("data-theme", resolved);
      }

      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          resolvedThemeDomMetadata[resolved].themeColor,
        );
    };

    applyTheme(); // On mount
    match.addEventListener("change", applyTheme); // On system change

    return () => match.removeEventListener("change", applyTheme);
  }, []);

  return null;
};

export default ThemeListener;
