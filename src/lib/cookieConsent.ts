export const COOKIE_CONSENT_KEY = "ht_cookie_consent";
export const COOKIE_CONSENT_CHANGE_EVENT = "ht-cookie-consent-change";
export type CookieConsent = "all" | "essential";

const isCookieConsent = (value: unknown): value is CookieConsent =>
  value === "all" || value === "essential";

function readConsentCookie(): string | null {
  const prefix = `${COOKIE_CONSENT_KEY}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  const saved = readConsentCookie();
  if (isCookieConsent(saved)) return saved;
  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    return isCookieConsent(value) ? value : null;
  } catch {
    return null;
  }
}

export function setCookieConsent(value: CookieConsent): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {
  }
  window.dispatchEvent(
    new CustomEvent<CookieConsent>(COOKIE_CONSENT_CHANGE_EVENT, { detail: value }),
  );
}

export function onCookieConsentChange(
  listener: (value: CookieConsent) => void,
): () => void {
  const handle = (event: Event) => {
    const value = (event as CustomEvent<unknown>).detail;
    if (isCookieConsent(value)) listener(value);
  };
  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, handle);
  return () => window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, handle);
}
