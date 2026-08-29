/**
 * UTM Constants
 * Single source of truth for UTM parameter keys and cookie names
 */

/**
 * List of all UTM parameter keys
 */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_group",
  "utm_creative",
  "utm_fbclid",
  "utm_id",
  "ip",
  "targetUrl",
] as const;

/**
 * Cookie names used for UTM tracking
 */
export const UTM_COOKIE_NAMES = {
  DATA: "utm_data",
  TIMESTAMP: "utm_timestamp",
} as const;

/**
 * All UTM-related cookie names (including individual parameter cookies)
 * Used for preserving cookies during signout
 */
export const ALL_UTM_COOKIE_NAMES: readonly string[] = [
  UTM_COOKIE_NAMES.DATA,
  UTM_COOKIE_NAMES.TIMESTAMP,
  ...UTM_KEYS,
];

/**
 * Default cookie expiration in days
 */
export const UTM_COOKIE_EXPIRY_DAYS = 30;

