import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isGuestUser } from "@/lib/demo/guest";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7289_RESUME_SIGNUP_PROVISIONING_FLAG } from "@/lib/flags/definitions/htpr-7289-resume-signup-provisioning";
import type { SignupAttribution } from "@/lib/telemetry/signupAnalytics";
import { recordSignupCompleted } from "@/lib/telemetry/signupCompleted";
import { provisionNewUser } from "./provisionNewUser";

export const SIGNUP_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecoverableIncompleteSignup(
  user: { uid: string; stripe_customer_id: string | null; joinedAt: Date },
  now: Date = new Date(),
): boolean {
  return !user.stripe_customer_id
    && !isGuestUser(user)
    && now.getTime() - user.joinedAt.getTime() < SIGNUP_RECOVERY_WINDOW_MS;
}

export async function resumeIncompleteSignup(input: {
  userId: number;
  displayName?: string | null;
  photoURL?: string | null;
  stripeCustomerNameEmail?: unknown;
  shouldSkipInteractive: boolean;
  skipOnboarding: boolean;
  isVerified: boolean;
  createGoogleAccount: boolean;
  signupAttribution: SignupAttribution;
  cookieHeader: string | null;
}): Promise<boolean> {
  const { userId, signupAttribution, cookieHeader, ...provisioning } = input;
  if (!(await findRecoverableUser(prisma, userId))) return false;
  if (!(await isFeatureEnabled(HTPR_7289_RESUME_SIGNUP_PROVISIONING_FLAG, userId))) return false;
  let provisioned = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7289::int, ${userId}::int)`;
      const user = await findRecoverableUser(tx, userId);
      if (!user) return;
      await provisionNewUser({
        userId,
        email: user.email,
        ...provisioning,
        displayName: provisioning.displayName ?? user.displayName,
        photoURL: provisioning.photoURL ?? user.photoURL,
        stripeCustomerNameEmail: provisioning.stripeCustomerNameEmail ?? user.email,
        resumingEarlierAttempt: true,
      });
      provisioned = true;
    }, { timeout: 30000, maxWait: 10000 });
  } catch (error) {
    console.error(provisioned
      ? "Resumed signup provisioning finished but its lock transaction failed to commit"
      : "CRITICAL: resuming incomplete signup provisioning failed; the account stays incomplete", { userId, error });
  }
  if (provisioned) recordSignupCompleted({ decision: null, cookieHeader, userId, ...signupAttribution });
  return provisioned;
}

async function findRecoverableUser(client: Pick<Prisma.TransactionClient, "user">, userId: number) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { uid: true, email: true, displayName: true, photoURL: true, stripe_customer_id: true, joinedAt: true },
  });
  return user && isRecoverableIncompleteSignup(user) ? user : null;
}
