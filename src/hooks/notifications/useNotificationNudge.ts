"use client";

import axios from "axios";
import nookies from "nookies";
import { useState } from "react";

import useFcmToken from "@/hooks/General/useFcmToken";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom, fcmAtom } from "@/store";
import { changePushNotificationStatus } from "@/utils/api/global/pushNotifications";

// Shared trigger + enable logic for the "both notification channels off" nudge.
// Lifted verbatim from the (now disabled) bottom banner so any nudge surface —
// currently the inbox pinned row (HTPR-4676) — behaves identically.
export function useNotificationNudge() {
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  const [fcmData, setFcmData] = useRecoilState(fcmAtom);
  const { retrieveToken } = useFcmToken();
  const [pending, setPending] = useState<"push" | "email" | null>(null);
  // Set when a push attempt finished without producing a token. This is the
  // common mobile case: retrieveToken() bails out on browsers where web push
  // is unsupported (iOS Safari outside an installed PWA, in-app browsers, the
  // Android WebView shell) and leaves permissionStatus untouched, so nothing
  // on screen changes and the primary action becomes a dead button (HTPR-4721).
  const [pushUnavailable, setPushUnavailable] = useState(false);

  // Push is only a live channel when the browser permission is granted AND the
  // user hasn't switched the in-app device toggle off (statusToggleFromDB).
  const pushOff =
    fcmData.permissionStatus !== "granted" ||
    fcmData.statusToggleFromDB !== "true";
  const emailOff =
    Boolean(currentUser) && !currentUser.UserSetting?.notification;
  const bothOff = Boolean(currentUser) && pushOff && emailOff;
  // "Denied" from the row's point of view means push is not something this
  // user can switch on here: the browser refused, or it cannot even ask.
  const pushDenied =
    fcmData.permissionStatus === "denied" || pushUnavailable;

  const enablePush = async () => {
    setPending("push");
    try {
      // retrieveToken only re-syncs the toggle to its current DB value, so it
      // never turns push back on for a user whose permission is already granted
      // but whose in-app device toggle is off. Get a token, then flip it on.
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
        // No token and no permission change: push cannot work here. Fall back
        // to the email treatment the product already defines for denied push,
        // so the row still offers a channel that reaches this user.
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
        // Guarantee the email flag is on locally so the nudge recomputes as
        // reachable, even if the response body omits UserSetting.
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
