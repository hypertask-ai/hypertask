export const COOKIE_CONSENT_KEY = "ht_cookie_consent";
export type CookieConsent = "all" | "essential";

export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    return value === "all" || value === "essential" ? value : null;
  } catch {
    return null;
  }
}

export function setCookieConsent(value: CookieConsent): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {
  }
}
