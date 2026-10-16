import { ALL_UTM_COOKIE_NAMES } from "@/lib/constants/utm";

export const COOKIE_CONSENT_KEY = "ht_cookie_consent";
export const COOKIE_CONSENT_CHANGE_EVENT = "ht-cookie-consent-change";
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 15_552_000;
export type CookieConsent = "all" | "essential";

const SHARED_CONSENT_DOMAIN = "hypertask.ai";
const ATTRIBUTION_COOKIE_NAMES = [...ALL_UTM_COOKIE_NAMES, "userAgent"];

const isCookieConsent = (value: unknown): value is CookieConsent =>
  value === "all" || value === "essential";

export function consentCookieDomain(hostname: string): string | null {
  return hostname === SHARED_CONSENT_DOMAIN ||
    hostname.endsWith(`.${SHARED_CONSENT_DOMAIN}`)
    ? `.${SHARED_CONSENT_DOMAIN}`
    : null;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

function writeConsentCookie(value: CookieConsent) {
  const domain = consentCookieDomain(window.location.hostname);
  document.cookie = [
    `${COOKIE_CONSENT_KEY}=${value}`,
    "Path=/",
    `Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(window.location.protocol === "https:" ? ["Secure"] : []),
    ...(domain ? [`Domain=${domain}`] : []),
  ].join("; ");
}

function takeLegacyStoredConsent(): CookieConsent | null {
  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    window.localStorage.removeItem(COOKIE_CONSENT_KEY);
    return isCookieConsent(value) ? value : null;
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  const shared = readCookie(COOKIE_CONSENT_KEY);
  if (isCookieConsent(shared)) return shared;
  const legacy = takeLegacyStoredConsent();
  if (legacy) writeConsentCookie(legacy);
  return legacy;
}

function expireCookie(name: string) {
  const domain = consentCookieDomain(window.location.hostname);
  const expired = `${name}=; Path=/; Max-Age=0`;
  document.cookie = expired;
  if (domain) document.cookie = `${expired}; Domain=${domain}`;
}

const isTrackingStorageKey = (key: string) =>
  key.startsWith("ph_") || key.includes("posthog");

function clearStorage(storage: Storage) {
  Object.keys(storage)
    .filter(isTrackingStorageKey)
    .forEach((key) => storage.removeItem(key));
}

export function clearTrackingStorage() {
  document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => isTrackingStorageKey(name) || ATTRIBUTION_COOKIE_NAMES.includes(name))
    .forEach(expireCookie);
  try {
    clearStorage(window.localStorage);
    clearStorage(window.sessionStorage);
  } catch {
    return;
  }
}

export function setCookieConsent(value: CookieConsent): void {
  writeConsentCookie(value);
  if (value === "essential") clearTrackingStorage();
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
