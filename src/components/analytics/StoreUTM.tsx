"use client";

import { useEffect } from "react";
import { 
  extractUTMFromURL, 
  storeUTMInCookies, 
  getUTMDataFromCookies,
  fetchIPAddress,
  getTargetUrl
} from "@/lib/utils/utm/client";

const UTMCookieHandler = () => {
  useEffect(() => {
    const captureUTMData = async () => {
      const utmParams = extractUTMFromURL();
      
      const existingData = getUTMDataFromCookies() || {};
      
      
      if (!existingData.ip) {
        try {
          const ip = await fetchIPAddress();
          if (ip) {
            utmParams.ip = ip;
          }
        } catch (error) {
          console.warn("Failed to fetch IP address:", error);
        }
      }

      if (!existingData.userAgent && typeof navigator !== 'undefined' && navigator.userAgent) {
        utmParams.userAgent = navigator.userAgent;
      }

      if (Object.keys(utmParams).length > 0) {
        console.log("🔍 UTM data to store:", utmParams);

        storeUTMInCookies(utmParams);

        const storedData = getUTMDataFromCookies();
        console.log("📦 UTM data stored in cookies:", storedData);
        
        const missingParams: string[] = [];
        Object.keys(utmParams).forEach((key) => {
          if (!storedData || !storedData[key as keyof typeof storedData]) {
            missingParams.push(key);
          }
        });
        
        if (missingParams.length > 0) {
          console.warn("⚠️ Some UTM parameters were not stored:", missingParams);
        }
      }
    };

    captureUTMData();
  }, []);

  return null;
};

export default UTMCookieHandler;
