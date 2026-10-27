import toast from "react-hot-toast";
import { useResetRecoilState } from "@/lib/state";
import useFcmToken from "@/hooks/General/useFcmToken";
import axios from "axios";
import { ALL_UTM_COOKIE_NAMES } from "@/lib/constants/utm";
import { showAIChatInterfaceAtom } from "@/store";
import { signOutAllAccounts } from "@/lib/auth/accounts";

export const useSignout = (_appHandler?: any) => {
  const { fcmToken } = useFcmToken();
  const resetAIChatInterface = useResetRecoilState(showAIChatInterfaceAtom);

  const handleHardReset = async (): Promise<boolean> => {
    if (typeof window !== "undefined") {
      let localReadModelsCleared = false;
      try {
        const { clearAllLocalReadModels } = await import(
          "@/lib/localReadModels/clear"
        );
        localReadModelsCleared = await clearAllLocalReadModels();
      } catch (error) {
        console.error("Could not delete local app data during sign out:", error);
      }

      if (!localReadModelsCleared) {
        toast.error(
          "Close other Hypertask tabs, then try signing out again so local app data can be removed.",
          { duration: 8_000 },
        );
        return false;
      }
    }

    if (fcmToken) {
      try {
        await axios.delete(`/api/users/addDevice?fcmToken=${fcmToken}`);
      } catch {
      }
    }

    try {
      await signOutAllAccounts();
    } catch {
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

    try {
      await axios.post("/api/auth/force-signout");
    } catch (error) {
      console.error("Could not clear httpOnly cookies during sign out:", error);
    }

    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }

    toast("Signed out successfully!");
    return true;
  };

  return { handleHardReset };
};
