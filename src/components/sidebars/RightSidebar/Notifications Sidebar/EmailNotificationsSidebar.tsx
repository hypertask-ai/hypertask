import axios from "axios";
import { ComponentType, useState } from "react";
import { ToggleSwitch, ToggleSwitchProps } from "../Single section items";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import nookies from "nookies";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";

const EmailNotificationSidebar = ({
  ToggleComponent = ToggleSwitch,
}: {
  ToggleComponent?: ComponentType<ToggleSwitchProps>;
} = {}) => {
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  const [allowNotification, setAllowNotification] = useState<boolean>(
    currentUser.UserSetting.notification
  );

  const updateUserStateAndCookie = (user: any) => {
    nookies.set(null, "nookies_user", JSON.stringify(slimUserForCookie(user)), {
      maxAge: 600 * 60 * 24 * 7, // 1 week
      path: "/",
    });
    setCurrentUser(user);
  };

  const handleNotification = (e: any) => {
    if (allowNotification === false) {
      setAllowNotification(true);
      changeNotificationStatus(true);
    } else {
      setAllowNotification(false);
      changeNotificationStatus(false);
    }
  };
  const changeNotificationStatus = async (status: boolean) => {
    try {
      const response = await axios.post("/api/users/changeStatus", {
        notification: status,
      });
      if (response.status == 200) {
        updateUserStateAndCookie(response.data.res);
      }
    } catch (error) {
      console.log("🤔 ~ changeNotificationStatus ~ error:", error);
    }
  };

  return (
    <ToggleComponent
      label="Email Notifications"
      inputId="email-notifications-toggle"
      value={allowNotification}
      checked={allowNotification}
      onChange={handleNotification}
    />
  );
};

export default EmailNotificationSidebar;
