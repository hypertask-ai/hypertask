import type { User, UserSetting } from "@prisma/client";
import { isGuestUser } from "@/lib/demo/guest";

export const WELCOME_COHORT_START = "2026-10-09T00:00:00Z";

export function onboardingIdentitySkipReason(user: Pick<User, "joinedAt" | "uid">) {
  if (user.joinedAt < new Date(WELCOME_COHORT_START)) return "pre_cohort";
  if (isGuestUser(user)) return "guest";
  // Managed agents have their own table; also exclude non-human UID prefixes.
  if (/^(service|agent|bot)_/i.test(user.uid)) return "service_identity";
  return null;
}

export function onboardingEmailSkipReason(user: User & { UserSetting: UserSetting | null }) {
  const reason = onboardingIdentitySkipReason(user);
  if (reason) return reason;
  if (!user.email || !(user.emailVerified || user.UserSetting?.isVerified)) return "unverified_email";
  if (!user.UserSetting || user.UserSetting.notification === false || user.UserSetting.notificationPreference === "nothing") return "notifications_off";
  return null;
}
