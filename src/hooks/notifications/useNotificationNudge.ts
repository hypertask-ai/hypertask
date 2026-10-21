"use client";

import axios from "axios";
import nookies from "nookies";
import { useState } from "react";

import useFcmToken from "@/hooks/General/useFcmToken";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom, fcmAtom } from "@/store";
import { changePushNotificationStatus } from "@/utils/api/global/pushNotifications";

export function useNotificationNudge() {
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  const [fcmData, setFcmData] = useRecoilState(fcmAtom);
  const { retrieveToken } = useFcmToken();
  const [pending, setPending] = useState<"push" | "email" | null>(null);
  const [pushUnavailable, setPushUnavailable] = useState(false);

  const pushOff =
    fcmData.permissionStatus !== "granted" ||
    fcmData.statusToggleFromDB !== "true";
  const emailOff =
    Boolean(currentUser) && !currentUser.UserSetting?.notification;
  const bothOff = Boolean(currentUser) && pushOff && emailOff;
  const pushDenied =
    fcmData.permissionStatus === "denied" || pushUnavailable;

  const enablePush = async () => {
    setPending("push");
    try {
      const existing = fcmData.fcmToken;
      const fcm = existing || (await retrieveToken()) || undefined;
      if (fcm) {
        await changePushNotificationStatus(fcm, true);
        setFcmData((prev) => ({
          ...prev,
          fcmToken: fcm,
          statusToggleFromDB: "true",
        }));
      } else {
        setPushUnavailable(true);
      }
    } catch (error) {
      console.log("useNotificationNudge enablePush error:", error);
      setPushUnavailable(true);
    } finally {
      setPending(null);
    }
  };

  const enableEmail = async () => {
    setPending("email");
    try {
      const response = await axios.post("/api/users/changeStatus", {
        notification: true,
      });
      if (response.status === 200) {
        const nextUser = {
          ...response.data.res,
          UserSetting: {
            ...(response.data.res?.UserSetting ?? currentUser?.UserSetting),
            notification: true,
          },
        };
        nookies.set(
          null,
          "nookies_user",
          JSON.stringify(slimUserForCookie(nextUser)),
          {
            maxAge: 600 * 60 * 24 * 7,
            path: "/",
          },
        );
        setCurrentUser(nextUser);
      }
    } catch (error) {
      console.log("useNotificationNudge enableEmail error:", error);
    } finally {
      setPending(null);
    }
  };

  return { bothOff, pushDenied, pending, enablePush, enableEmail };
}
