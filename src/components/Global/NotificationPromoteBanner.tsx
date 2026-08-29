"use client";

import axios from "axios";
import { Bell, X } from "lucide-react";
import nookies from "nookies";
import { usePathname } from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";

import useFcmToken from "@/hooks/General/useFcmToken";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { changePushNotificationStatus } from "@/utils/api/global/pushNotifications";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} from "@/lib/state";
import {
  appShellRailAtom,
  currentUserAtom,
  fcmAtom,
  notifPromoteBannerVisibleAtom,
} from "@/store";

// Parked: the persistent bottom bar overlaid the AI chat + comment composers on
// every surface. Kept mounted so the trigger/enable logic stays intact; flip
// this to re-enable once a non-overlay presentation is chosen (HTPR-4518).
const BANNER_ENABLED = false;

const STORAGE_KEY = "ht_notif_promote_banner";
const SESSION_DISMISS_KEY = `${STORAGE_KEY}_dismissed`;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type BannerStage = 1 | 2;

interface BannerPreference {
  stage: BannerStage;
  dismissedAt: number | null;
}

const DEFAULT_PREFERENCE: BannerPreference = {
  stage: 1,
  dismissedAt: null,
};

const readPreference = (): BannerPreference => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PREFERENCE;

    const parsed = JSON.parse(saved);
    return {
      stage: parsed?.stage === 2 ? 2 : 1,
      dismissedAt:
        typeof parsed?.dismissedAt === "number" ? parsed.dismissedAt : null,
    };
  } catch {
    return DEFAULT_PREFERENCE;
  }
};

const readSessionDismissed = () => {
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "true";
  } catch {
    return false;
  }
};

const NotificationPromoteBanner = () => {
  const pathname = usePathname();
  const mbl = useContext(MobileViewContext);
  // When the left app-shell rail is on, start the bar after it (48px) so it
  // never covers the rail's bottom gear/settings — same rule the quick-tips
  // strip uses.
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !mbl;
  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom);
  const [fcmData, setFcmData] = useRecoilState(fcmAtom);
  const setBannerVisible = useSetRecoilState(notifPromoteBannerVisibleAtom);
  const { retrieveToken } = useFcmToken();
  const bannerRef = useRef<HTMLDivElement>(null);
  const [preference, setPreference] =
    useState<BannerPreference>(DEFAULT_PREFERENCE);
  const [dismissedThisSession, setDismissedThisSession] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [mountedAt, setMountedAt] = useState(0);
  const [pendingAction, setPendingAction] = useState<"push" | "email" | null>(
    null
  );

  useEffect(() => {
    setPreference(readPreference());
    setDismissedThisSession(readSessionDismissed());
    setMountedAt(Date.now());
    setMounted(true);
  }, []);

  // Push is only a live channel when the browser permission is granted AND the
  // user hasn't switched the in-app device toggle off (statusToggleFromDB).
  const pushOff =
    fcmData.permissionStatus !== "granted" ||
    fcmData.statusToggleFromDB !== "true";
  const emailOff =
    Boolean(currentUser) && !currentUser.UserSetting?.notification;
  const triggerActive = Boolean(currentUser) && pushOff && emailOff;
  const excludedRoute =
    pathname?.startsWith("/onboarding") ||
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/trial-plan-confirmation") ||
    // Off on the task detail page: the bar spans the comment box and the AI
    // chat composer at the bottom. Board views only.
    pathname?.startsWith("/detail") ||
    // Off on mobile entirely: it collided with the mobile bottom bar. Desktop
    // only until there's a mobile-native concept.
    mbl;
  const snoozed =
    preference.stage === 2 &&
    preference.dismissedAt !== null &&
    mountedAt - preference.dismissedAt < SNOOZE_MS;
  const shouldRender =
    BANNER_ENABLED &&
    mounted &&
    triggerActive &&
    !excludedRoute &&
    !dismissedThisSession &&
    !snoozed;

  useEffect(() => {
    setBannerVisible(shouldRender);
    return () => setBannerVisible(false);
  }, [setBannerVisible, shouldRender]);

  // Publish the banner's height as a CSS var so the bottom chrome (gear cluster,
  // quick tips) can sit ABOVE it instead of being covered.
  useEffect(() => {
    const root = document.documentElement;
    if (!shouldRender) {
      root.style.setProperty("--notif-banner-h", "0px");
      return;
    }
    const el = bannerRef.current;
    if (!el) return;
    const apply = () =>
      root.style.setProperty("--notif-banner-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--notif-banner-h", "0px");
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!mounted || !currentUser || triggerActive) return;

    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_DISMISS_KEY);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    setPreference(DEFAULT_PREFERENCE);
    setDismissedThisSession(false);
  }, [currentUser, mounted, triggerActive]);

  const savePreference = (nextPreference: BannerPreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPreference));
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    } catch {
      // Still dismiss the banner for the current component lifetime.
    }
    setPreference(nextPreference);
    setDismissedThisSession(true);
  };

  const dismiss = () => {
    if (preference.stage === 1) {
      // A null timestamp promotes stage 2 without applying its seven-day snooze.
      savePreference({ stage: 2, dismissedAt: null });
      return;
    }

    savePreference({ stage: 2, dismissedAt: Date.now() });
  };

  const enablePush = async () => {
    setPendingAction("push");
    try {
      // retrieveToken only re-syncs the toggle to its current DB value, so it
      // never turns push back on for a user whose permission is already granted
      // but whose in-app device toggle is off. Get a token, then flip it on.
      let token = fcmData.fcmToken;
      if (!token) {
        token = (await retrieveToken()) || undefined;
      }
      if (token) {
        await changePushNotificationStatus(token, true);
        setFcmData((prev) => ({
          ...prev,
          fcmToken: token,
          statusToggleFromDB: "true",
        }));
      }
    } catch (error) {
      console.log("NotificationPromoteBanner enablePush error:", error);
    } finally {
      setPendingAction(null);
    }
  };

  const enableEmail = async () => {
    setPendingAction("email");
    try {
      const response = await axios.post("/api/users/changeStatus", {
        notification: true,
      });
      if (response.status === 200) {
        // Guarantee the email flag is on locally so the banner recomputes as
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
      console.log("NotificationPromoteBanner enableEmail error:", error);
    } finally {
      setPendingAction(null);
    }
  };

  if (!shouldRender) return null;

  const pushDenied = fcmData.permissionStatus === "denied";
  const copy =
    preference.stage === 1
      ? "Turn on notifications so tasks and mentions reach you."
      : "Without notifications it's much harder for your team to reach you.";

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-label="Enable notifications"
      style={{ left: appShellRailOn ? "var(--app-shell-rail-w, 48px)" : 0 }}
      className="fixed right-0 bottom-0 z-[299] border-t border-[#232a39] bg-[#10131a] pb-[env(safe-area-inset-bottom)] text-content text-[#e9edf1]"
    >
      <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3 py-2">
        <div className="flex min-w-0 basis-full flex-1 items-center justify-center gap-3 sm:basis-auto sm:justify-start">
          <Bell
            aria-hidden
            className="shrink-0 text-hypertasks-green"
            size={18}
            strokeWidth={1.75}
          />
          <span className="min-w-0">{copy}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="font-semibold text-hypertasks-green underline-offset-2 hover:underline focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
            disabled={pendingAction !== null}
            onClick={pushDenied ? enableEmail : enablePush}
          >
            {pushDenied ? "Get updates by email" : "Enable notifications"}
          </button>
          {!pushDenied && (
            <button
              type="button"
              className="text-meta text-[#aeb6c6] underline-offset-2 hover:text-[#ffffff] hover:underline focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
              disabled={pendingAction !== null}
              onClick={enableEmail}
            >
              or get them by email
            </button>
          )}
          {preference.stage === 2 && (
            <button
              type="button"
              className="text-meta text-[#aeb6c6] underline-offset-2 hover:text-[#ffffff] hover:underline focus-visible:outline-none"
              onClick={dismiss}
            >
              I&apos;ll do it later
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss notification banner"
            className="text-[#8790a3] hover:text-[#ffffff] focus-visible:outline-none"
            onClick={dismiss}
          >
            <X aria-hidden size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationPromoteBanner;
