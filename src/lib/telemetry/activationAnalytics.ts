import "server-only";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { FEATURE_FLAG_QA_USER_ID, HTPR_7034_ACTIVATION_ANALYTICS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { recordServerCapture, scheduleAnalytics } from "./signupAnalytics";

export type ActivationEvent =
  | "board_created"
  | "agent_connected"
  | "agent_task_completed"
  | "teammate_invited"
  | "invite_accepted"
  | "lifecycle_email_sent";

export async function isActivationEligible(userId: number): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === FEATURE_FLAG_QA_USER_ID) return false;
  if (!(await isFeatureEnabled(HTPR_7034_ACTIVATION_ANALYTICS_FLAG, userId))) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { uid: true, email: true },
  });
  const qaEmail = process.env.QA_LOGIN_EMAIL?.trim().toLowerCase();
  return !!user && !isGuestUser(user) && !(qaEmail && user.email.trim().toLowerCase() === qaEmail);
}

export async function trackActivation(
  userId: number,
  event: ActivationEvent,
  props: Record<string, unknown> = {},
): Promise<void> {
  scheduleAnalytics(async () => {
    if (!(await isActivationEligible(userId))) return;
    recordServerCapture({ distinctId: String(userId), event, properties: props });
  });
}
