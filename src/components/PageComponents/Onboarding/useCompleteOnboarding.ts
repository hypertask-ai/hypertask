"use client";
import { useCallback } from "react";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import nookies from "nookies";
import { updateUserSettingOnboarding } from "@/lib/serverActions";
import { useRouter } from "next/navigation";
import { USER_API_CONTROLLER } from "@/utils/api/users";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";

/** Marks onboarding done (tour flag + refreshed user cookie). Shared by the tutorial and launch screens. */
export const useCompleteOnboarding = () => {
  const router = useRouter();
  const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);

  const completeOnboarding = useCallback(async () => {
    if (!currentUser) return false;
    if (!currentUser.UserSetting.onboardingTourStatus) {
      await updateUserSettingOnboarding(currentUser.id, true);

      const payload = {
        email: currentUser.email,
        user: {
          photoURL: currentUser.photoURL,
          displayName: currentUser.displayName,
          email: currentUser.email,
          uid: currentUser.uid,
        },
        sendOnboardingEvent: true,
      };
      const response = await USER_API_CONTROLLER.getorUpdateUser(payload);

      const { user } = await response.data;

      nookies.set(null, "nookies_user", JSON.stringify(slimUserForCookie(user)), {
        maxAge: 600 * 60 * 24 * 7, // 1 week
        path: "/",
      });
      _setCurrentUser(user);
    }
    router.refresh();
    return true;
  }, [currentUser, _setCurrentUser, router]);

  return { completeOnboarding, currentUser };
};
