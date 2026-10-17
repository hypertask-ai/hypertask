import "server-only";
import type { Prisma } from "@prisma/client";
import { enqueueAnalyticsIntent } from "./analyticsIntents";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { HTPR_7270_SIGNUP_COMPLETED_FLAG, isFeatureEnabled } from "@/lib/flags";
import { strictestConsent, type SignupLinkDecision } from "@/lib/analytics/signupIdentity";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { legacyAccountCategory } from "./savedWorkAnalytics";
import { buildUserSignedUpCapture, postHogClient, type SignupMethod } from "./signupAnalytics";

export type SignupCompletedPayload = {
  userId: number;
  signupMethod: SignupMethod;
  utmSource: string | null;
  consentAll: boolean;
  anonymousId: string | null;
  attribution: { utm_source?: string; utm_medium?: string; utm_campaign?: string; initial_referrer?: string } | null;
  attributionStatus: SignupLinkDecision["attributionStatus"] | null;
};

export async function enqueueSignupCompleted(db: Pick<Prisma.TransactionClient, "analyticsIntent">, input: {
  userId: number;
  signupMethod: SignupMethod;
  utmSource?: string;
  decision: SignupLinkDecision | null;
  cookieHeader: string | null;
}): Promise<string> {
  const { userId, signupMethod, decision } = input;
  const consentAll = strictestConsent("all", input.cookieHeader) === "all";
  const attribution = decision?.attribution;
  return enqueueAnalyticsIntent(db, { kind: "signup_completed", payload: {
    userId, signupMethod, consentAll, utmSource: consentAll ? input.utmSource?.trim().slice(0, 200) || null : null,
    anonymousId: consentAll && decision?.link ? decision.anonymousId : null,
    attribution: consentAll && attribution ? {
      ...(attribution.utm_source ? { utm_source: attribution.utm_source } : {}),
      ...(attribution.utm_medium ? { utm_medium: attribution.utm_medium } : {}),
      ...(attribution.utm_campaign ? { utm_campaign: attribution.utm_campaign } : {}),
      ...(attribution.initial_referrer ? { initial_referrer: attribution.initial_referrer } : {}),
    } : null,
    attributionStatus: decision?.attributionStatus ?? null,
  } });
}

export async function captureSignupCompleted(payload: SignupCompletedPayload): Promise<void> {
  const { userId, signupMethod, utmSource, consentAll, anonymousId, attribution, attributionStatus } = payload;
  if (!(await isFeatureEnabled(HTPR_7270_SIGNUP_COMPLETED_FLAG, userId))) {
    await postHogClient()?.captureImmediate(buildUserSignedUpCapture({ userId, signupMethod, utmSource: utmSource ?? undefined }));
    return;
  }
  if (!Number.isSafeInteger(userId) || userId <= 0) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, uid: true, email: true, joinedAt: true },
  });
  if (!user || isGuestUser(user)) return;
  const team = await prisma.team.findFirst({
    where: { googleAccount: { userId } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const source = utmSource?.trim().slice(0, 200) || null;
  await captureAnalyticsOccurrence(userId, "signup_completed", "analytics:signup_completed", {
    ...serverAnalyticsProperties(userId, team?.id ?? null, null, `signup_completed:${userId}`, user.joinedAt),
    signup_method: signupMethod,
    signup_at: user.joinedAt.toISOString(),
    account_category: legacyAccountCategory(user),
    ...(anonymousId && consentAll ? { anonymous_id: anonymousId } : {}),
    utm_source: consentAll ? attribution ? attribution.utm_source ?? null : source : null,
    utm_medium: consentAll ? attribution?.utm_medium ?? null : null,
    utm_campaign: consentAll ? attribution?.utm_campaign ?? null : null,
    initial_referrer: consentAll ? attribution?.initial_referrer ?? null : null,
    attribution_status: !consentAll ? "withheld" : attributionStatus ?? (source ? "known" : "unknown"),
  }, { scope: "user" });
}
