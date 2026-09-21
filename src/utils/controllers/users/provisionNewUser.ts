import { LogType, Status } from "@prisma/client";
import { CreateLogInput } from "@/models/model";
import { stripe } from "@/lib/subscription";
import createLog from "../logs/createLog";
import autoJoinByEmailDomain from "./autoJoinByEmailDomain";

import prisma from "@/lib/prisma";

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
}: ProvisionNewUserInput) => {
  await prisma.user_Activity.create({
    data: {
      userId,
      totalTeamsOwned: 0,
      lastActiveAt: new Date(),
    },
  });
  const createLogBody: CreateLogInput = {
    log: `${email} just signed up for HyperTask`,
    type: LogType.Signup,
    status: Status.Normal,
    LoggedById: userId,
  };
  createLog(createLogBody);
  // =================== CREATE USER SETTINGS
  const userSetting = await prisma.userSetting.create({
    data: {
      notification: true,
      userId,
      onboardingTourStatus: skipOnboarding,
      onboardingTutorialStatus: shouldSkipInteractive,
      isVerified: isVerified,
    },
  });

  await prisma.userPicture.create({
    data: {
      basePhotoURL: photoURL,
      userId,
      displayName,
    },
  });

  const getAllAnnouncements = await prisma.announcments.findMany();
  getAllAnnouncements.map(async (item) => {
    await prisma.userAnnouncement.createMany({
      data: {
        userId,
        announcementId: item.id,
      },
    });
  });

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      UserSettingId: userSetting.id,
    },
    include: {
      UserSetting: true,
      userPicture: true,
    },
  });

  // =================== CREATE Google Account and attach the user with it
  const googleAccount = createGoogleAccount
    ? await prisma.googleAccount.create({
        data: {
          userId,
          stripe_customer_id: "",
        },
      })
    : null;
  if (googleAccount) {
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        accountId: googleAccount.id,
      },
    });
  }
  // =================== CREATE stripe customer
  const customer = await stripe.customers.create({
    name: String(stripeCustomerNameEmail) + `${googleAccount?.id ?? ""}`,
  });

  // now update the googleaccount with the right stripeId
  if (googleAccount) {
    await prisma.googleAccount.update({
      where: {
        id: googleAccount.id,
      },
      data: {
        stripe_customer_id: customer.id,
      },
    });
  }

  // =================== AUTO-JOIN teams that allowlisted this email domain
  // Only for a proven mailbox. instant-signup provisions with isVerified: false and
  // hands back a login token, so auto-joining here unverified would let anyone claim
  // ceo@allowlisted-company.com and walk into that team's paid boards. Users who
  // verify later are auto-joined from the verify-code / verify-email-token routes.
  // Never fatal: a signup must still succeed if seat billing or Stripe fails.
  if (isVerified) {
    try {
      await autoJoinByEmailDomain(userId, email);
    } catch (error) {
      console.error("Auto-join by email domain failed (non-fatal):", error);
    }
  }

  // =========== RETURNING point for NEW USER
  return prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      stripe_customer_id: customer.id,
      ...(googleAccount ? { accountId: googleAccount.id } : {}),
    },
    include: {
      UserSetting: true,
    },
  });
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

  //set default if none is set
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
