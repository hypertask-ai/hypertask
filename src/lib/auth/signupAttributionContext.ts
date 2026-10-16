import { createHash, randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG } from "@/lib/flags/definitions/htpr-7269-signup-identity-link";
import { normalizeSignupContext, strictestConsent, type SignupIdentityContext } from "@/lib/analytics/signupIdentity";

export const SIGNUP_CONTEXT_COOKIE = "ht_signup_ctx";
export const signupContextCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};
const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const contextKey = (id: string) => `auth:signup-context:${hash(id)}`;
async function codeAttemptKey(email: string, code: string, used: boolean): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const attempt = await prisma.verificationCode.findUnique({
    where: { email: normalizedEmail },
    select: { code: true, createdAt: true, used: true },
  });
  if (!attempt || attempt.code !== code || attempt.used !== used) return null;
  return `auth:signup-code:${hash(`${normalizedEmail}:${code}:${attempt.createdAt.toISOString()}`)}`;
}

export function warnSignupContextUnavailable(): void {
  console.warn("[signup-identity] unlinked", { reason: "context_unavailable" });
}

export async function createSignupContext(input: unknown, ttlSeconds = 1800, cookieHeader: string | null = null): Promise<string | null> {
  if (!input || typeof input !== "object") return null;
  const consent = (input as Record<string, unknown>).consent;
  if (consent !== null && consent !== "all" && consent !== "essential") return null;
  try {
    if (!await isFeatureEnabled(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG, 0)) return null;
    const id = randomUUID();
    const context = normalizeSignupContext({ ...input, consent: strictestConsent(consent, cookieHeader) });
    const { method, email } = input as Record<string, unknown>;
    if (method === "google" || method === "magic_link") context.method = method;
    if (method === "magic_link" && typeof email === "string") context.emailHash = hash(email.trim().toLowerCase());
    await (await getRedis()).set(contextKey(id), JSON.stringify(context), "EX", ttlSeconds);
    return id;
  } catch {
    warnSignupContextUnavailable();
    return null;
  }
}

export async function consumeSignupContext(id: unknown): Promise<SignupIdentityContext | null> {
  if (!validId(id)) return null;
  try {
    const value = await (await getRedis()).getdel(contextKey(id));
    if (!value) return null;
    const context = JSON.parse(value) as SignupIdentityContext;
    return context.v === 1 ? context : null;
  } catch {
    warnSignupContextUnavailable();
    return { ...normalizeSignupContext(null), reason: "context_unavailable", attributionStatus: "unknown" };
  }
}

export async function bindSignupCodeContext(email: string, code: string, id: string | null): Promise<void> {
  try {
    if (!id) return;
    const key = await codeAttemptKey(email, code, false);
    if (key) await (await getRedis()).set(key, id, "EX", 1800);
  } catch {
    warnSignupContextUnavailable();
  }
}

export async function takeSignupCodeContext(email: string, code: string): Promise<string | null> {
  try {
    if (!await isFeatureEnabled(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG, 0)) return null;
    const key = await codeAttemptKey(email, code, true);
    return key ? await (await getRedis()).getdel(key) : null;
  } catch {
    warnSignupContextUnavailable();
    return null;
  }
}

export async function consumeGoogleSignupContext(oauthState: Record<string, unknown> | null): Promise<SignupIdentityContext | null> {
  const stored = await consumeSignupContext(oauthState?.signupContextId);
  if (stored && stored.reason !== "context_unavailable" && stored.method !== "google") {
    return { ...normalizeSignupContext(null), reason: "attempt_mismatch", attributionStatus: "unknown" };
  }
  return stored;
}

type SignupCookieContext = {
  request?: Request;
  setCookie?: (name: string, value: string, options: typeof signupContextCookieOptions) => unknown;
};

export async function consumeSignupCookie(
  context: SignupCookieContext | null | undefined,
  attempt?: { method: "google" | "magic_link"; email: string },
): Promise<SignupIdentityContext | null> {
  try {
    const id = context?.request?.headers.get("cookie")?.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${SIGNUP_CONTEXT_COOKIE}=`))?.slice(SIGNUP_CONTEXT_COOKIE.length + 1);
    if (!id) return null;
    context?.setCookie?.(SIGNUP_CONTEXT_COOKIE, "", { ...signupContextCookieOptions, maxAge: 0 });
    const stored = await consumeSignupContext(id);
    if (stored && attempt && (stored.method !== attempt.method ||
      (attempt.method === "magic_link" && stored.emailHash !== hash(attempt.email.trim().toLowerCase())))) {
      return { ...normalizeSignupContext(null), reason: "attempt_mismatch", attributionStatus: "unknown" };
    }
    return stored;
  } catch {
    warnSignupContextUnavailable();
    return { ...normalizeSignupContext(null), reason: "context_unavailable", attributionStatus: "unknown" };
  }
}
