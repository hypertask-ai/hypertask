import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useResetRecoilState } from "@/lib/state";
import useFcmToken from "@/hooks/General/useFcmToken";
import axios from "axios";
import { ALL_UTM_COOKIE_NAMES } from "@/lib/constants/utm";
import { showAIChatInterfaceAtom } from "@/store";
import { signOutAllAccounts } from "@/lib/auth/accounts";

export const useSignout = (_appHandler?: any) => {
  const { fcmToken } = useFcmToken();
  const queryClient = useQueryClient();
  const resetAIChatInterface = useResetRecoilState(showAIChatInterfaceAtom);

  const handleHardReset = async (): Promise<boolean> => {
    if (fcmToken) {
      try {
        await axios.delete(`/api/users/addDevice?fcmToken=${fcmToken}`, { timeout: 2_000 });
      } catch {
      }
    }

    const signedOut = await signOutAllAccounts();
    if (!signedOut) {
      toast.error("Could not sign out. Please try again.");
      return false;
    }
    queryClient.clear();

    if (typeof window !== "undefined") {
      let localReadModelsCleared = false;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        localReadModelsCleared = await Promise.race([
          import("@/lib/localReadModels/clear").then(({ clearAllLocalReadModels }) => clearAllLocalReadModels()),
          new Promise<boolean>((resolve) => {
            cleanupTimer = setTimeout(() => resolve(false), 1_500);
          }),
        ]);
      } catch (error) {
        console.error("Could not delete local app data during sign out:", error);
      } finally {
        clearTimeout(cleanupTimer);
      }

      if (!localReadModelsCleared) {
        toast.error(
          "Signing out. Close other Hypertask tabs to finish removing local app data.",
          { duration: 8_000 },
        );
      }
    }

    try {
      resetAIChatInterface();
    } catch (error) {
      console.error("Could not reset AI chat state during sign out:", error);
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.clear();
        document.cookie.split(";").forEach((c) => {
          const cookieName = c.split("=")[0].trim();
          if (
            cookieName !== "theme" &&
            !ALL_UTM_COOKIE_NAMES.includes(cookieName)
          ) {
            document.cookie =
              cookieName + "=;expires=" + new Date(0).toUTCString() + ";path=/";
          }
        });
      } catch (error) {
        console.error("Could not clear browser state during sign out:", error);
      }
    }

    try {
      _appHandler?.();
    } catch (error) {
      console.error("Could not reset app state during sign out:", error);
    }

    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }

    toast("Signed out successfully!");
    return true;
  };

  return { handleHardReset };
};
