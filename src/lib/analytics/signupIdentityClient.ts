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

export async function prepareSignupContext(method: "google" | "magic_link", email?: string): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/signup-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ...getSignupContextInput(), method, ...(method === "magic_link" ? { email } : {}) }),
      signal: AbortSignal.timeout(1500),
    });
    if (method !== "google" || !response.ok) return null;
    const { signupContextId } = await response.json() as { signupContextId?: unknown };
    return typeof signupContextId === "string" ? signupContextId : null;
  } catch {
    return null;
  }
}

export async function googleSignupAdditionalData(enabled: boolean) {
  const signupContextId = enabled ? await prepareSignupContext("google") : null;
  return signupContextId ? { additionalData: { signupContextId } } : {};
}
