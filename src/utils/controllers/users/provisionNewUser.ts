import { createHash } from "node:crypto";
import { LogType, Status } from "@prisma/client";
import { CreateLogInput } from "@/models/model";
import { stripe } from "@/lib/subscription";
import createLog from "../logs/createLog";
import autoJoinByEmailDomain from "./autoJoinByEmailDomain";

import prisma from "@/lib/prisma";
import { stripeCustomerName } from "@/lib/stripeCustomerName";

type ProvisionNewUserInput = {
  userId: number;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
  stripeCustomerNameEmail?: unknown;
  shouldSkipInteractive: boolean;
  skipOnboarding: boolean;
  isVerified: boolean;
  createGoogleAccount?: boolean;
  resumingEarlierAttempt?: boolean;
};

export const provisionNewUser = async ({
  userId,
  email,
  displayName,
  photoURL,
  stripeCustomerNameEmail,
  shouldSkipInteractive,
  skipOnboarding,
  isVerified,
  createGoogleAccount = true,
  resumingEarlierAttempt = false,
}: ProvisionNewUserInput) => {
  await prisma.user_Activity.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      totalTeamsOwned: 0,
      lastActiveAt: new Date(),
    },
  });
  const signupLog = await prisma.logs.findFirst({
    where: { LoggedById: userId, type: LogType.Signup, log: `${email} just signed up for HyperTask` },
    select: { id: true },
  });
  if (!signupLog) {
    const createLogBody: CreateLogInput = {
      log: `${email} just signed up for HyperTask`,
      type: LogType.Signup,
      status: Status.Normal,
      LoggedById: userId,
    };
    createLog(createLogBody);
  }
  const userSetting = await prisma.userSetting.upsert({
    where: { userId },
    update: {},
    create: {
      notification: true,
      userId,
      onboardingTourStatus: skipOnboarding,
      onboardingTutorialStatus: shouldSkipInteractive,
      isVerified: isVerified,
    },
  });

  await prisma.userPicture.upsert({
    where: { userId },
    update: {},
    create: {
      basePhotoURL: photoURL,
      userId,
      displayName,
    },
  });

  const getAllAnnouncements = await prisma.announcments.findMany();
  await prisma.userAnnouncement.createMany({
    data: getAllAnnouncements.map((item) => ({
      userId,
      announcementId: item.id,
    })),
    skipDuplicates: true,
  });

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      UserSettingId: userSetting.id,
    },
  });

  const googleAccount = createGoogleAccount ? await findOrCreateGoogleAccount(userId) : null;
  const customerId = await findOrCreateSignupStripeCustomer({
    userId,
    googleAccount,
    name: stripeCustomerName(stripeCustomerNameEmail),
    resumingEarlierAttempt,
  });

  if (isVerified) {
    try {
      await autoJoinByEmailDomain(userId, email);
    } catch (error) {
      console.error("Auto-join by email domain failed (non-fatal):", error);
    }
  }

  return prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      stripe_customer_id: customerId,
      ...(googleAccount ? { accountId: googleAccount.id } : {}),
    },
    include: {
      UserSetting: true,
    },
  });
};

const findOrCreateGoogleAccount = async (userId: number) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
  const linked = user?.accountId
    ? await prisma.googleAccount.findFirst({ where: { id: user.accountId, userId } })
    : null;
  const googleAccount =
    linked ??
    (await prisma.googleAccount.findFirst({ where: { userId } })) ??
    (await prisma.googleAccount.create({ data: { userId, stripe_customer_id: "" } }));
  await prisma.user.update({ where: { id: userId }, data: { accountId: googleAccount.id } });
  return googleAccount;
};

const findOrCreateSignupStripeCustomer = async ({
  userId,
  googleAccount,
  name,
  resumingEarlierAttempt,
}: {
  userId: number;
  googleAccount: { id: string; stripe_customer_id: string | null } | null;
  name: string | undefined;
  resumingEarlierAttempt: boolean;
}) => {
  if (googleAccount?.stripe_customer_id) return googleAccount.stripe_customer_id;
  const metadata = { hypertaskUserId: String(userId), ...(googleAccount ? { googleAccountId: googleAccount.id } : {}) };
  const earlier = resumingEarlierAttempt ? await findEarlierSignupStripeCustomer(metadata) : undefined;
  const customer = earlier ?? await stripe.customers.create(
    { name, metadata },
    { idempotencyKey: `hypertask-user:${userId}:signup-stripe-customer:${requestFingerprint({ name, metadata })}` },
  );
  if (googleAccount) {
    await prisma.googleAccount.updateMany({
      where: { id: googleAccount.id, stripe_customer_id: "" },
      data: { stripe_customer_id: customer.id },
    });
  }
  return customer.id;
};

const findEarlierSignupStripeCustomer = async (metadata: Record<string, string>) => {
  const query = Object.entries(metadata).map(([key, value]) => `metadata['${key}']:'${value}'`).join(" OR ");
  return (await stripe.customers.search({ query, limit: 1 })).data[0];
};

const requestFingerprint = (request: unknown) =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 16);

export const updateUserProfilePicture = async (
  userId: number,
  photoURLFromGoogle: string,
  displayName: string
) => {
  const foundUser = await prisma.user.findFirst({
    where: {
      id: userId,
    },
    include: {
      userPicture: true,
    },
  });

  if (foundUser?.userPicture?.photoSet) {
    await prisma.userPicture.update({
      where: {
        userId,
      },
      data: {
        basePhotoURL: photoURLFromGoogle,
        displayName,
      },
    });
  } else {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        photoURL: photoURLFromGoogle,
      },
    });
  }
};
