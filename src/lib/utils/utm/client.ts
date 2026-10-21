
import { UTMParams } from "@/lib/types/utm";
import { UTM_KEYS, UTM_COOKIE_NAMES } from "@/lib/constants/utm";
import { getCookie, setCookie } from "./cookies";

export async function fetchIPAddress(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
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


export function extractUTMFromURL(): UTMParams {
  if (typeof window === "undefined") {
    return {};
  }

  const urlParams = new URLSearchParams(window.location.search);
  const utmParams: UTMParams = {};

  UTM_KEYS.forEach((key) => {
    const value = urlParams.get(key);
    if (value) {
      utmParams[key as keyof UTMParams] = value;
    }
  });

  return utmParams;
}

export function getTargetUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.href;
}

export function getUTMDataFromCookies(): UTMParams | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const utmDataCookie = getCookie(UTM_COOKIE_NAMES.DATA);
  if (utmDataCookie) {
    try {
      const parsedData = JSON.parse(utmDataCookie) as UTMParams;

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

  const utmData: UTMParams = {};

  UTM_KEYS.forEach((key) => {
    const value = getCookie(key);
    if (value) {
      utmData[key as keyof UTMParams] = value;
    }
  });

  if (Object.keys(utmData).length === 0) {
    return undefined;
  }

  return utmData;
}

export function storeUTMInCookies(utmParams: UTMParams): void {
  if (typeof document === "undefined" || Object.keys(utmParams).length === 0) {
    return;
  }

  const existingUTMData = getUTMDataFromCookies() || {};

  const mergedUTMData = { ...existingUTMData, ...utmParams };

  const jsonString = JSON.stringify(mergedUTMData);
  
  const cookieSize = encodeURIComponent(jsonString).length;
  if (cookieSize > 4096) {
    console.warn(
      `⚠️ UTM cookie size (${cookieSize} bytes) exceeds 4KB limit. Some data may be truncated.`,
      mergedUTMData
    );
  }

  setCookie(UTM_COOKIE_NAMES.DATA, jsonString);

  Object.entries(mergedUTMData).forEach(([key, value]) => {
    if (value && typeof value === "string") {
      setCookie(key, value);
    }
  });

  setCookie(UTM_COOKIE_NAMES.TIMESTAMP, new Date().toISOString());

  console.log("✅ UTM parameters stored:", {
    newParams: utmParams,
    mergedData: mergedUTMData,
    cookieSize: `${cookieSize} bytes`,
    allKeys: Object.keys(mergedUTMData),
  });
}

export function getUTMDataFiltered(): UTMParams | undefined {
  const allUTMData = getUTMDataFromCookies();

  if (!allUTMData) return undefined;

  const filteredData: UTMParams = {};
  Object.entries(allUTMData).forEach(([key, value]) => {
    if (value && typeof value === "string" && value.trim() !== "") {
      filteredData[key as keyof UTMParams] = value;
    }
  });

  return Object.keys(filteredData).length > 0 ? filteredData : undefined;
}

