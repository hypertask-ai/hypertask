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

    // Release this browser's push token FIRST, while the session still exists:
    // the route now requires one, and revoking the session or clearing cookies
    // beforehand would leave the token registered and this browser receiving
    // the departing account's notifications (HTPR-4865).
    // IndexedDB deletion is the mandatory local precondition above; this remains
    // the first operation in the authenticated cleanup sequence.
    if (fcmToken) {
      try {
        await axios.delete(`/api/users/addDevice?fcmToken=${fcmToken}`);
      } catch {
        // Notification-device cleanup must not strand an already-signed-out
        // user in the app instead of taking them to /login.
      }
    }

    // A legacy-only session may not have a Better Auth session to revoke.
    // Full logout is best-effort: no failed cleanup step may prevent the
    // remaining cookies from being cleared or the browser reaching /login.
    // That best-effort sequence begins only after local deletion is confirmed.
    try {
      await signOutAllAccounts();
    } catch {
      // Continue with local and server-side cookie cleanup.
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
