import { IBM_Plex_Sans } from "next/font/google";

export const IBM_PLEX_SANS_LATIN_FONT_HREF = "/_next/static/media/26d4368bf94c0ec4-s.woff2";

export const ibmPlexSans = IBM_Plex_Sans({
  weight: "variable",
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
  preload: false,
});
