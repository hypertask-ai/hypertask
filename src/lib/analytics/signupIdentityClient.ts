import { getCookieConsent } from "@/lib/cookieConsent";
import { getUTMDataFromCookies } from "@/lib/utils/utm/client";
import { consentAllowsLinking, readSignupBrowserIdentity, sanitizeSignupAttribution, type SignupIdentitySdk } from "./signupIdentity";

export async function getSignupBrowserIdentity() {
  const consent = getCookieConsent();
  let sdk: SignupIdentitySdk | null = null;
  if (consentAllowsLinking(consent)) {
    try {
      const { default: posthog } = await import("posthog-js/dist/module.slim");
      if (posthog.__loaded === true) sdk = posthog;
    } catch {}
  }
  return readSignupBrowserIdentity(sdk, consent);
}

export async function getSignupContextInput() {
  const identity = await getSignupBrowserIdentity();
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
      body: JSON.stringify({ ...await getSignupContextInput(), method, ...(method === "magic_link" ? { email } : {}) }),
      signal: AbortSignal.timeout(1500),
    });
    if (method !== "google" || !response.ok) return null;
    const { signupContextId } = await response.json() as { signupContextId?: unknown };
    return typeof signupContextId === "string" ? signupContextId : null;
  } catch {
    return null;
  }
}

export async function attachSignupContext(context: { url: URL | string; body?: unknown }) {
  try {
    const pathname = new URL(context.url, "https://app.hypertask.ai").pathname;
    if (!pathname.endsWith("/sign-in/social") && !pathname.endsWith("/sign-in/magic-link")) return;
    if (typeof context.body !== "string") return;
    const body = JSON.parse(context.body);
    if (pathname.endsWith("/sign-in/social") && body.provider === "google") {
      const id = await prepareSignupContext("google");
      if (id) return { body: JSON.stringify({ ...body, additionalData: { ...body.additionalData, signupContextId: id } }) };
    } else if (pathname.endsWith("/sign-in/magic-link") && typeof body.email === "string") {
      await prepareSignupContext("magic_link", body.email);
    }
  } catch {}
}
