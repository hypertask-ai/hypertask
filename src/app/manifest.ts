import type { MetadataRoute } from "next";
import {
  DEFAULT_THEME_PREFERENCE,
  resolveInitialThemeColor,
} from "@/lib/themePreferences";

export default function manifest(): MetadataRoute.Manifest {
  const initialThemeColor = resolveInitialThemeColor(DEFAULT_THEME_PREFERENCE);

  return {
    theme_color: initialThemeColor,
    background_color: initialThemeColor,
    display: "standalone",
    scope: "/",
    start_url: "/",
    name: "Hypertask",
    short_name: "Hypertask",
    description: "Super Fast Kanban with AI",
    launch_handler: {
      client_mode: ["navigate-existing", "focus-existing", "auto"],
    },
    icons: [
      { src: "/logo.png", sizes: "228x228", type: "image/png" },
      { src: "/icon-112x112.png", sizes: "112x112", type: "image/png" },
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-256x256.png", sizes: "256x256", type: "image/png" },
      { src: "/icon-384x384.png", sizes: "384x384", type: "image/png" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
