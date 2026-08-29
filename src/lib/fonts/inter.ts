import { Inter } from "next/font/google";

/** Single Inter instance for the app — variable font covers weights 100–900. */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
