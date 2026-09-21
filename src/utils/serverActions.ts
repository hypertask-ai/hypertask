"use server";

import { headers } from "next/headers";
import { UAParser } from "ua-parser-js";

export const isMobileDevice = async () => {
  if (typeof process === "undefined") {
    throw new Error(
      "[Server method] This module is intended to run only on the server."
    );
  }

  const headersList = await headers();
  const userAgent = headersList.get("user-agent") || ""; // Fallback to empty string if header is not available
  // console.log("🚀 ~ isMobileDevice ~ userAgent:", userAgent);

  const uaParser = new UAParser(userAgent);
  // console.log("🚀 ~ isMobileDevice ~ uaParser:", uaParser);
  const OS = uaParser.getOS();
  const device = uaParser.getDevice() || {}; // Fallback to empty object if no device information is available
  // console.log("🚀 ~ isMobileDevice ~ OS:", OS);
  // console.log("🚀 ~ isMobileDevice ~ device:", device);

  const { type = null, vendor = null } = device; // Use destructuring with default values

  // Check if the device is mobile based on type or OS
  const isMobile =
    Boolean(
      type === "mobile" ||
      (OS.name && OS.name.toLowerCase().includes("android")) ||
      (OS.name && OS.name.toLowerCase().includes("ios"))
    );

  const isApple = Boolean(
    (device.vendor?.toLowerCase() === "apple") ||
    (OS.name &&
      (OS.name.toLowerCase().includes("mac os") || OS.name.toLowerCase().includes("ios")))
  );


  return {
    type, // Device type (e.g., "mobile", "tablet", or null if unavailable)
    isMobile: isMobile ?? false, // True if the device is a mobile or has mobile OS
    isApple, // True if the device is running macOS or iOS
  };
};

