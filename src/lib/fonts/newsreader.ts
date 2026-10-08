import { Newsreader } from "next/font/google";

export const NEWSREADER_LATIN_FONT_HREFS = [
  "/_next/static/media/5611c55482296524-s.woff2",
  "/_next/static/media/4b9bb515ce6d026f-s.woff2",
];

export const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
});
