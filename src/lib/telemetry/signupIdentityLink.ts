import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG } from "@/lib/flags/definitions/htpr-7269-signup-identity-link";
import { HTPR_7290_DURABLE_SIGNUP_IDENTIFY_FLAG } from "@/lib/flags/definitions/htpr-7290-durable-signup-identify";
import { decideSignupIdentityLink, strictestConsent, type SignupIdentityContext, type SignupLinkDecision } from "@/lib/analytics/signupIdentity";
import { consumeSignupContext, warnSignupContextUnavailable } from "@/lib/auth/signupAttributionContext";
import { recordServerCapture, scheduleAnalytics } from "./signupAnalytics";
import { deliverAnalyticsOutbox } from "./analyticsOutbox";

export function signupIdentityUuid(userId: number): string {
  const bytes = createHash("sha256").update(`hypertask:signup-identity:${userId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function queueSignupIdentify(userId: number, anonymousId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7290::int, hashtext(${anonymousId}))`;
    const key = `${userId}:analytics:signup_identify`;
    const existing = await tx.analyticsOutbox.findUnique({ where: { key } });
    if (existing) return existing;
    const linkedToAnotherAccount = await tx.analyticsOutbox.findFirst({ where: {
      event: "$identify", userId: { not: userId },
      properties: { path: ["$anon_distinct_id"], equals: anonymousId },
    } });
    if (linkedToAnotherAccount) return null;
    return tx.analyticsOutbox.create({ data: {
      key, userId, event: "$identify", uuid: signupIdentityUuid(userId),
      properties: { $anon_distinct_id: anonymousId }, occurredAt: new Date(),
    } });
  }, { timeout: 20000, maxWait: 1500 });
}

function unlinked(decision: SignupLinkDecision, reason: string): SignupLinkDecision {
  console.warn("[signup-identity] unlinked", { reason });
  return { link: false, reason, attribution: decision.attribution, attributionStatus: decision.attributionStatus };
}

export async function recordSignupIdentityLink(
  userId: number,
  isNewUser: boolean,
  contextOrId: SignupIdentityContext | string | null = null,
  cookieHeader: string | null = null,
): Promise<SignupLinkDecision | null> {
  try {
    const context = typeof contextOrId === "string" ? await consumeSignupContext(contextOrId) : contextOrId;
    if (!isNewUser || !await isFeatureEnabled(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG, userId)) return null;
    const decision: SignupLinkDecision = context && strictestConsent("all", cookieHeader) !== "all"
      ? { link: false, reason: "consent_withdrawn", attribution: {}, attributionStatus: "withheld" }
      : decideSignupIdentityLink(userId, context);
    if (decision.link && await isFeatureEnabled(HTPR_7290_DURABLE_SIGNUP_IDENTIFY_FLAG, userId)) {
      let row;
      try {
        row = await queueSignupIdentify(userId, decision.anonymousId);
      } catch {
        return unlinked(decision, "link_not_persisted");
      }
      if (!row) return unlinked(decision, "anonymous_id_already_linked");
      if (!row.deliveredAt) scheduleAnalytics(() => deliverAnalyticsOutbox(row));
    } else if (decision.link) {
      recordServerCapture({
        distinctId: String(userId),
        event: "$identify",
        properties: { $anon_distinct_id: decision.anonymousId },
        uuid: signupIdentityUuid(userId),
      });
    } else {
      console.warn("[signup-identity] unlinked", { reason: decision.reason });
    }
    return decision;
  } catch {
    warnSignupContextUnavailable();
    return { link: false, reason: "context_unavailable", attribution: {}, attributionStatus: "unknown" };
  }
}
