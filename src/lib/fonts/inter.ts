import { Inter } from "next/font/google";

export const INTER_LATIN_FONT_HREF = "/_next/static/media/e4af272ccee01ff0-s.woff2";

/** Single Inter instance for the app, covering weights 100 to 900. */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});
