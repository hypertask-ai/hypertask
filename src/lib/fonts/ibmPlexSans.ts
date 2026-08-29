import { IBM_Plex_Sans } from "next/font/google";

/** AMOLED theme font — see src/styles/tailwindThemes/amoled.css `.amoled { font-family }`. */
export const ibmPlexSans = IBM_Plex_Sans({
  weight: "variable",
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
  // Theme selectors use weights 400–700. The variable file covers that range
  // without emitting four separate static font resources into the app layout.
  // Keep preload off so themes that do not use Plex do not fetch it.
  preload: false,
});
