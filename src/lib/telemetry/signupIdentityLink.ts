import { createHash } from "node:crypto";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG } from "@/lib/flags/definitions/htpr-7269-signup-identity-link";
import { decideSignupIdentityLink, type SignupIdentityContext, type SignupLinkDecision } from "@/lib/analytics/signupIdentity";
import { consumeSignupContext, warnSignupContextUnavailable } from "@/lib/auth/signupAttributionContext";
import { recordServerCapture } from "./signupAnalytics";

export function signupIdentityUuid(userId: number): string {
  const bytes = createHash("sha1").update(`hypertask:signup-identity:${userId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function recordSignupIdentityLink(
  userId: number,
  isNewUser: boolean,
  contextOrId: SignupIdentityContext | string | null = null,
): Promise<SignupLinkDecision | null> {
  try {
    const context = typeof contextOrId === "string" ? await consumeSignupContext(contextOrId) : contextOrId;
    if (!isNewUser || !await isFeatureEnabled(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG, userId)) return null;
    const decision = decideSignupIdentityLink(userId, context);
    if (decision.link) {
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
