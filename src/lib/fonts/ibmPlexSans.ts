import { IBM_Plex_Sans } from "next/font/google";

// The seeded document needs this existing Latin asset before its first paint.
// The disposable build proof checks this content-addressed URL against the CSS.
export const IBM_PLEX_SANS_LATIN_FONT_HREF = "/_next/static/media/26d4368bf94c0ec4-s.woff2";

/** Core theme font; applied by the AMOLED, Graphite, and Porcelain stylesheets. */
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
