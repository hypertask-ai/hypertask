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
  const customer = await stripe.customers.create({
    name: stripeCustomerName(stripeCustomerNameEmail),
    ...(googleAccount ? { metadata: { googleAccountId: googleAccount.id } } : {}),
  });

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
