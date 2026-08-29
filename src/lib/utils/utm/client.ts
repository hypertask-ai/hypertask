/**
 * Client-side UTM utilities
 * Functions for extracting UTM parameters from URL and managing UTM cookies
 */

import { UTMParams } from "@/lib/types/utm";
import { UTM_KEYS, UTM_COOKIE_NAMES } from "@/lib/constants/utm";
import { getCookie, setCookie } from "./cookies";

/**
 * Fetch user's IP address from a public API
 * @returns Promise that resolves to IP address string or null if failed
 */
export async function fetchIPAddress(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // Try ipify.org first (simple and reliable)
    const response = await fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.ip || null;
    }
  } catch (error) {
    console.warn('Failed to fetch IP address from ipify:', error);
    
    // Fallback to alternative service
    try {
      const fallbackResponse = await fetch('https://api.ipapi.com/api/check?access_key=free', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json();
        return data.ip || null;
      }
    } catch (fallbackError) {
      console.warn('Failed to fetch IP address from fallback service:', fallbackError);
    }
  }

  return null;
}


/**
 * Extract UTM parameters from the current URL
 */
export function extractUTMFromURL(): UTMParams {
  if (typeof window === "undefined") {
    return {};
  }

  const urlParams = new URLSearchParams(window.location.search);
  const utmParams: UTMParams = {};

  // Extract UTM parameters from URL
  UTM_KEYS.forEach((key) => {
    const value = urlParams.get(key);
    if (value) {
      utmParams[key as keyof UTMParams] = value;
    }
  });

  return utmParams;
}

/**
 * Capture current page URL as targetUrl
 */
export function getTargetUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.href;
}

/**
 * Get UTM data from cookies
 * Tries to get from utm_data cookie first, falls back to individual cookies
 */
export function getUTMDataFromCookies(): UTMParams | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  // Try to get UTM data from the main utm_data cookie first (most reliable)
  const utmDataCookie = getCookie(UTM_COOKIE_NAMES.DATA);
  if (utmDataCookie) {
    try {
      const parsedData = JSON.parse(utmDataCookie) as UTMParams;

      // Also get the timestamp if available
      const timestamp = getCookie(UTM_COOKIE_NAMES.TIMESTAMP);
      if (timestamp) {
        parsedData.utm_timestamp = timestamp;
      }

      return parsedData;
    } catch (error) {
      console.warn(
        "Failed to parse utm_data cookie, falling back to individual cookies"
      );
    }
  }

  // Fallback: collect UTM data from individual cookies
  const utmData: UTMParams = {};

  UTM_KEYS.forEach((key) => {
    const value = getCookie(key);
    if (value) {
      utmData[key as keyof UTMParams] = value;
    }
  });

  // Return undefined if no UTM data found
  if (Object.keys(utmData).length === 0) {
    return undefined;
  }

  return utmData;
}

/**
 * Store UTM parameters in cookies
 * Merges with existing UTM data (new parameters take precedence)
 */
export function storeUTMInCookies(utmParams: UTMParams): void {
  if (typeof document === "undefined" || Object.keys(utmParams).length === 0) {
    return;
  }

  // Get existing UTM data from cookies
  const existingUTMData = getUTMDataFromCookies() || {};

  // Merge new UTM parameters with existing ones (new ones take precedence)
  const mergedUTMData = { ...existingUTMData, ...utmParams };

  // Store as JSON string in cookie
  const jsonString = JSON.stringify(mergedUTMData);
  
  // Check cookie size limit (4KB = 4096 bytes)
  const cookieSize = encodeURIComponent(jsonString).length;
  if (cookieSize > 4096) {
    console.warn(
      `⚠️ UTM cookie size (${cookieSize} bytes) exceeds 4KB limit. Some data may be truncated.`,
      mergedUTMData
    );
  }

  setCookie(UTM_COOKIE_NAMES.DATA, jsonString);

  // Also store individual UTM parameters as separate cookies for easy access
  // Store ALL merged params (not just new ones) to ensure complete fallback
  Object.entries(mergedUTMData).forEach(([key, value]) => {
    if (value && typeof value === "string") {
      setCookie(key, value);
    }
  });

  // Store timestamp of when UTM data was captured
  setCookie(UTM_COOKIE_NAMES.TIMESTAMP, new Date().toISOString());

  // Log for debugging
  console.log("✅ UTM parameters stored:", {
    newParams: utmParams,
    mergedData: mergedUTMData,
    cookieSize: `${cookieSize} bytes`,
    allKeys: Object.keys(mergedUTMData),
  });
}

/**
 * Get filtered UTM data (only non-empty values)
 */
export function getUTMDataFiltered(): UTMParams | undefined {
  const allUTMData = getUTMDataFromCookies();

  if (!allUTMData) return undefined;

  // Filter out undefined/empty values
  const filteredData: UTMParams = {};
  Object.entries(allUTMData).forEach(([key, value]) => {
    if (value && typeof value === "string" && value.trim() !== "") {
      filteredData[key as keyof UTMParams] = value;
    }
  });

  return Object.keys(filteredData).length > 0 ? filteredData : undefined;
}

