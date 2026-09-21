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
      // Extract UTM parameters from URL
      const utmParams = extractUTMFromURL();
      
      // Get existing UTM data from cookies
      const existingData = getUTMDataFromCookies() || {};
      
      // Always capture targetUrl (current page URL) - only if not already set
      // This ensures we capture the first page where user signed up
      // if (!existingData.targetUrl) {
      //   utmParams.targetUrl = getTargetUrl();
      // }
      
      // Always fetch IP address if not already stored
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

      // Always capture user agent if not already stored
      // Note: Server-side will always override with current request's user agent for Meta compliance
      if (!existingData.userAgent && typeof navigator !== 'undefined' && navigator.userAgent) {
        utmParams.userAgent = navigator.userAgent;
      }

      // Store data if we have UTM parameters, IP, or targetUrl to store
      if (Object.keys(utmParams).length > 0) {
        console.log("🔍 UTM data to store:", utmParams);

        // Store UTM parameters in cookies (merges with existing data)
        storeUTMInCookies(utmParams);

        // Verify storage by reading back
        const storedData = getUTMDataFromCookies();
        console.log("📦 UTM data stored in cookies:", storedData);
        
        // Check for missing parameters
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

  // This component doesn't render anything
  return null;
};

export default UTMCookieHandler;
