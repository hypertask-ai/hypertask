import { LogType, Status, type Prisma } from "@prisma/client";
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

export const provisionNewUser = async (input: ProvisionNewUserInput) => {
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7289::int, ${input.userId}::int)`;
    const existing = await tx.user.findUnique({
      where: { id: input.userId },
      include: { UserSetting: true },
    });
    if (existing?.stripe_customer_id) return existing;
    return provisionUser(tx, input);
  }, { timeout: 30000, maxWait: 10000 });

  if (input.isVerified) {
    try {
      await autoJoinByEmailDomain(input.userId, input.email);
    } catch (error) {
      console.error("Auto-join by email domain failed (non-fatal):", error);
    }
  }
  return user;
};

const provisionUser = async (db: Prisma.TransactionClient, {
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
  await db.user_Activity.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      totalTeamsOwned: 0,
      lastActiveAt: new Date(),
    },
  });
  const signupLog = await db.logs.findFirst({
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
  const userSetting = await db.userSetting.upsert({
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

  await db.userPicture.upsert({
    where: { userId },
    update: {},
    create: {
      basePhotoURL: photoURL,
      userId,
      displayName,
    },
  });

  const getAllAnnouncements = await db.announcments.findMany();
  await db.userAnnouncement.createMany({
    data: getAllAnnouncements.map((item) => ({
      userId,
      announcementId: item.id,
    })),
    skipDuplicates: true,
  });

  await db.user.update({
    where: {
      id: userId,
    },
    data: {
      UserSettingId: userSetting.id,
    },
  });

  const googleAccount = await findOrCreateGoogleAccount(db, userId, createGoogleAccount);
  const customerId = await findOrCreateSignupStripeCustomer(db, {
    userId,
    googleAccount,
    name: stripeCustomerName(stripeCustomerNameEmail),
    resumingEarlierAttempt,
  });

  return db.user.update({
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

const findOrCreateGoogleAccount = async (db: Prisma.TransactionClient, userId: number, createIfMissing: boolean) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { accountId: true } });
  const linked = user?.accountId
    ? await db.googleAccount.findFirst({ where: { id: user.accountId, userId } })
    : null;
  const existing = linked ?? (await db.googleAccount.findFirst({ where: { userId } }));
  if (!existing && !createIfMissing) return null;
  const googleAccount = existing ?? (await db.googleAccount.create({ data: { userId, stripe_customer_id: "" } }));
  await db.user.update({ where: { id: userId }, data: { accountId: googleAccount.id } });
  return googleAccount;
};

const findOrCreateSignupStripeCustomer = async (db: Prisma.TransactionClient, {
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
    { idempotencyKey: `hypertask-user:${userId}:signup-stripe-customer` },
  );
  if (googleAccount) {
    await db.googleAccount.updateMany({
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
