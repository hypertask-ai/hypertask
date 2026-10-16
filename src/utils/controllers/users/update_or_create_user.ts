import { recordSignupIdentityLink } from "@/lib/telemetry/signupIdentityLink";
import prisma from "@/lib/prisma";
import authConfig from "@/lib/configs/auth.config";
import { generalConfig } from "@/lib/configs/general.config";
import type { SignupAttribution } from "@/lib/telemetry/signupAnalytics";
import { recordSignupCompleted } from "@/lib/telemetry/signupCompleted";
import {
  provisionNewUser,
  updateUserProfilePicture,
} from "./provisionNewUser";
import { findUserByEmail } from "./findUserByEmail";

const update_or_create_user = async (
  email: string,
  user: any,
  shouldSkipInteractive: boolean = authConfig.onboarding.shouldSkipInteractive,
  skipOnboarding: boolean = authConfig.onboarding.skipOnboarding,
  isVerified: boolean = true,
  signupAttribution: SignupAttribution = { signupMethod: "email" },
  signupContextId: string | null = null,
  cookieHeader: string | null = null,
) => {
  try {
    if (!email || !user) {
      return {
        status: 400,
        res: { message: "Required param is missing" },
      };
    }

    let exist_user = await findUserByEmail(email, { UserSetting: true });

    let isNewUser = false;


    if (!exist_user) {
      isNewUser = true;

      const userWithPhoto = {
        ...user,
        photoURL: user.photoURL
          ? user.photoURL
          : generalConfig.defaultPhotoURL,
      };

      exist_user = await prisma.user.create({
        data: {
          email: email,
          ...userWithPhoto,
        },
        include: {
          UserSetting: true,
        },
      });

      const decision = await recordSignupIdentityLink(exist_user.id, true, signupContextId, cookieHeader);

      recordSignupCompleted({
        decision,
        cookieHeader,
        userId: exist_user.id,
        ...signupAttribution,
      });

      exist_user = await provisionNewUser({
        userId: exist_user.id,
        email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        stripeCustomerNameEmail: user?.email,
        shouldSkipInteractive,
        skipOnboarding,
        isVerified,
      });
    }

    else {
      await recordSignupIdentityLink(exist_user.id, false, signupContextId, cookieHeader);
      const googleAc = await prisma.googleAccount.findFirst({
        where: {
          userId: exist_user.id,
        },
      });
      await prisma.user.update({
        where: {
          id: exist_user.id,
        },
        data: {
          accountId: googleAc?.id,
          displayName: user.displayName,
        },
      });

      await updateUserProfilePicture(exist_user.id, user.photoURL, user.displayName);

      if (shouldSkipInteractive && exist_user.UserSetting) {
        await prisma.userSetting.update({
          where: {
            id: exist_user.UserSetting.id,
          },
          data: {
            onboardingTutorialStatus: true,
          },
        });
      }

      const updatedUser = await prisma.user.findFirst({
        where: {
          id: exist_user.id,
        },
        include: {
          UserSetting: true,
          userPicture: true,
        },
      });
      console.log(
        "🚀 ~ file: update.ts:223 ~ updateUsers ~ updatedUser:",
        updatedUser
      );
      return {
        status: 200,
        res: {
          user: updatedUser,
          isNewUser,
        },
      };
    }

    return {
      status: 200,
      res: {
        user: exist_user,
        isNewUser,
      },
    };
  } catch (error) {
    console.log(error);
    return {
      status: 500,
      res: { message: "Internal server error" },
    };
  }
};

export default update_or_create_user;
