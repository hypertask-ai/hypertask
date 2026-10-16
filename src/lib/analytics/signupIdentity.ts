import type { CookieConsent } from "@/lib/cookieConsent";

export type SignupConsent = CookieConsent | null;
export type AttributionStatus = "withheld" | "known" | "direct" | "unknown";
export const SIGNUP_UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type SignupVisitAttribution = Partial<Record<typeof SIGNUP_UTM_KEYS[number] | "initial_referrer", string>>;
export type SignupIdentityContext = {
  v: 1;
  consent: SignupConsent;
  anonymousId: string | null;
  reason: string | null;
  attribution: SignupVisitAttribution;
  attributionStatus: AttributionStatus;
  createdAt: number;
};

export function consentAllowsLinking(consent: SignupConsent): boolean {
  return consent === "all";
}

export function strictestConsent(reported: SignupConsent, cookieHeader: string | null | undefined): SignupConsent {
  const stored = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("ht_cookie_consent="))?.slice("ht_cookie_consent=".length);
  if (stored === undefined) return reported;
  return stored === "all" ? reported : "essential";
}

export function sanitizeSignupAttribution(input: unknown): SignupVisitAttribution {
  const attribution: SignupVisitAttribution = {};
  if (!input || typeof input !== "object") return attribution;
  const values = input as Record<string, unknown>;
  for (const key of SIGNUP_UTM_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) attribution[key] = value.trim().slice(0, 200);
  }
  if (typeof values.initial_referrer === "string") {
    try {
      const url = new URL(values.initial_referrer.trim());
      if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "app.hypertask.ai") {
        attribution.initial_referrer = `${url.origin}${url.pathname}`.slice(0, 200);
      }
    } catch {}
  }
  return attribution;
}

export function normalizeSignupContext(input: unknown): SignupIdentityContext {
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const consent = values.consent === "all" || values.consent === "essential" ? values.consent : null;
  const allowed = consentAllowsLinking(consent);
  const attribution = allowed ? sanitizeSignupAttribution(values.attribution) : {};
  const anonymousId = allowed && typeof values.anonymousId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(values.anonymousId)
    ? values.anonymousId : null;
  const reason = !allowed ? "consent_denied" : anonymousId ? null
    : values.reason === "already_identified" ? "already_identified" : "sdk_not_ready";
  return {
    v: 1, consent, anonymousId, reason, attribution,
    attributionStatus: !allowed ? "withheld" : Object.keys(attribution).length ? "known" : "direct",
    createdAt: Date.now(),
  };
}

export type SignupLinkDecision = ({ link: true; anonymousId: string } | { link: false; reason: string }) & {
  attribution: SignupVisitAttribution;
  attributionStatus: AttributionStatus;
};

export function decideSignupIdentityLink(userId: number, context: SignupIdentityContext | null): SignupLinkDecision {
  const attribution = context?.attribution ?? {};
  const attributionStatus = context?.attributionStatus ?? "unknown";
  const result = { attribution, attributionStatus };
  if (!context) return { ...result, link: false, reason: "context_missing" };
  if (context.attributionStatus === "unknown") return { ...result, link: false, reason: context.reason ?? "context_missing" };
  if (!consentAllowsLinking(context.consent)) return { ...result, link: false, reason: "consent_denied" };
  if (!context.anonymousId) return { ...result, link: false, reason: context.reason ?? "anonymous_id_missing" };
  if (context.anonymousId === String(userId) || /^\d+$/.test(context.anonymousId)) {
    return { ...result, link: false, reason: "already_identified" };
  }
  return { ...result, link: true, anonymousId: context.anonymousId };
}

export type SignupIdentitySdk = {
  get_property: (key: string) => unknown;
  get_distinct_id: () => string;
};

export function readSignupBrowserIdentity(sdk: SignupIdentitySdk | null, consent: SignupConsent) {
  if (!consentAllowsLinking(consent)) return { anonymousId: null, consent, reason: "consent_denied" };
  if (!sdk) return { anonymousId: null, consent, reason: "sdk_not_ready" };
  const state = sdk.get_property("$user_state");
  const userId = sdk.get_property("$user_id");
  if (state === "identified" ||
    (state !== "anonymous" && userId !== undefined && userId !== null && userId !== "")) {
    return { anonymousId: null, consent, reason: "already_identified" };
  }
  return { anonymousId: sdk.get_distinct_id(), consent, reason: null };
}
