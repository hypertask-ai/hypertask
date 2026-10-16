import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { HTPR_7270_SIGNUP_COMPLETED_FLAG, isFeatureEnabled } from "@/lib/flags";
import { strictestConsent, type SignupLinkDecision } from "@/lib/analytics/signupIdentity";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { accountCategory } from "./savedWorkAnalytics";
import { recordUserSignedUp, scheduleAnalytics, type SignupMethod } from "./signupAnalytics";

export function recordSignupCompleted(input: {
  userId: number;
  signupMethod: SignupMethod;
  utmSource?: string;
  decision: SignupLinkDecision | null;
  cookieHeader: string | null;
}): void {
  scheduleAnalytics(async () => {
    const { userId, signupMethod, utmSource, decision, cookieHeader } = input;
    if (!(await isFeatureEnabled(HTPR_7270_SIGNUP_COMPLETED_FLAG, userId))) {
      recordUserSignedUp({ isNewUser: true, userId, signupMethod, utmSource });
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
    const consentAll = strictestConsent("all", cookieHeader) === "all";
    const source = utmSource?.trim().slice(0, 200) || null;
    await captureAnalyticsOccurrence(userId, "signup_completed", "analytics:signup_completed", {
      ...serverAnalyticsProperties(userId, team?.id ?? null, null, `signup_completed:${userId}`, user.joinedAt),
      signup_method: signupMethod,
      signup_at: user.joinedAt.toISOString(),
      account_category: accountCategory(user),
      ...(decision?.link && consentAll ? { anonymous_id: decision.anonymousId } : {}),
      utm_source: consentAll ? decision ? decision.attribution.utm_source ?? null : source : null,
      utm_medium: consentAll ? decision?.attribution.utm_medium ?? null : null,
      utm_campaign: consentAll ? decision?.attribution.utm_campaign ?? null : null,
      initial_referrer: consentAll ? decision?.attribution.initial_referrer ?? null : null,
      attribution_status: !consentAll ? "withheld" : decision?.attributionStatus ?? (source ? "known" : "unknown"),
    }, { scope: "user" });
  });
}
