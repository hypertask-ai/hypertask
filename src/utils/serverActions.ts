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
  const userAgent = headersList.get("user-agent") || "";

  const uaParser = new UAParser(userAgent);
  const OS = uaParser.getOS();
  const device = uaParser.getDevice() || {};

  const { type = null, vendor = null } = device;

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
    type,
    isMobile: isMobile ?? false,
    isApple,
  };
};

