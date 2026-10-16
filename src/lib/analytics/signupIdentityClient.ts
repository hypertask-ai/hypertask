import { getCookieConsent } from "@/lib/cookieConsent";
import { getUTMDataFromCookies } from "@/lib/utils/utm/client";
import { consentAllowsLinking, readSignupBrowserIdentity, sanitizeSignupAttribution, type SignupIdentitySdk } from "./signupIdentity";

let loadedSdk: SignupIdentitySdk | null = null;

export function setSignupIdentitySdk(sdk: SignupIdentitySdk | null): void {
  loadedSdk = sdk;
}

export function getSignupBrowserIdentity() {
  return readSignupBrowserIdentity(loadedSdk, getCookieConsent());
}

export function getSignupContextInput() {
  const identity = getSignupBrowserIdentity();
  const allowed = consentAllowsLinking(identity.consent);
  return {
    consent: identity.consent,
    reason: identity.reason,
    ...(allowed ? { anonymousId: identity.anonymousId } : {}),
    attribution: !allowed ? {} : sanitizeSignupAttribution({
      ...getUTMDataFromCookies(),
      initial_referrer: typeof document === "undefined" ? undefined : document.referrer,
    }),
  };
}

export async function prepareSignupContext(): Promise<void> {
  try {
    await fetch("/api/auth/signup-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(getSignupContextInput()),
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}
