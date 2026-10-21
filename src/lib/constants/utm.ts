
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

export const UTM_COOKIE_NAMES = {
  DATA: "utm_data",
  TIMESTAMP: "utm_timestamp",
} as const;

export const ALL_UTM_COOKIE_NAMES: readonly string[] = [
  UTM_COOKIE_NAMES.DATA,
  UTM_COOKIE_NAMES.TIMESTAMP,
  ...UTM_KEYS,
];

export const UTM_COOKIE_EXPIRY_DAYS = 30;

