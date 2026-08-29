import prisma from "@/lib/prisma";
import authConfig from "@/lib/configs/auth.config";
import { generalConfig } from "@/lib/configs/general.config";
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
  isVerified: boolean = true
) => {
  try {
    if (!email || !user) {
      return {
        status: 400,
        res: { message: "Required param is missing" },
      };
    }

    // HTPR-4156: Gmail treats dots and +suffixes as noise, so the same inbox can
    // arrive as several different strings. Exact match first, then the Gmail
    // fallback, otherwise a user who typed their own address a different way got
    // a second empty account instead of signing in.
    let exist_user = await findUserByEmail(email, { UserSetting: true });

    let isNewUser = false; // Flag to track if this is a new user signup

    // =======================================================================================================================
    // ================================== NEW USER ======================
    // =======================================================================================================================

    if (!exist_user) {
      isNewUser = true; // Set flag to true for new user

      // =================== CREATE USER
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

    // =======================================================================================================================
    // ================================== EXISTING USER ======================
    // =======================================================================================================================
    else {
      // For existing users, find the googleAccount using the existing user's ID, not user.id
      const googleAc = await prisma.googleAccount.findFirst({
        where: {
          userId: exist_user.id,
        },
      });
      // HTPR-4156: key off the resolved id, not the typed string. When the Gmail
      // fallback matched a dot-variant, `email` is not what is stored on the row,
      // so this updated nothing.
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

      // Update onboardingTutorialStatus for existing users if shouldSkipInteractive is true
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

      // HTPR-4156: by id, for the same reason as the update above.
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
