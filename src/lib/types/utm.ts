/**
 * UTM Parameters interface
 * Represents all possible UTM tracking parameters
 */
export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_group?: string;
  utm_creative?: string;
  utm_fbclid?: string;
  utm_id?: string;
  utm_timestamp?: string; // Added for timestamp tracking
  ip?: string; // IPv6 address
  targetUrl?: string; // The page they signed up
  userAgent?: string; // User agent string for Meta conversion tracking
}

