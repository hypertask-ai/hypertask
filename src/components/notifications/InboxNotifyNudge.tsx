"use client";

import { Bell, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useNotificationNudge } from "@/hooks/notifications/useNotificationNudge";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";

const DISMISS_KEY = "ht_inbox_notif_nudge_dismissed";

const InboxNotifyNudge = () => {
  const { bothOff, pushDenied, pending, enablePush, enableEmail } =
    useNotificationNudge();
  const mbl = useContext(MobileViewContext);
  const snapshot = useFirstScreenSurface();
  const hydrated = useHydrated();
  const inboxDocument = !hydrated ? getInboxDocument(snapshot, snapshot?.scope.accountId ?? 0) : null;
  const [mounted, setMounted] = useState(Boolean(inboxDocument));
  const [dismissed, setDismissed] = useState(() => inboxDocument ? !inboxDocument.data.nudge.visible : true);
  const visible = !hydrated && inboxDocument ? inboxDocument.data.nudge.visible : bothOff && !dismissed;
  const denied = !hydrated && inboxDocument ? inboxDocument.data.nudge.pushDenied : pushDenied;

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {
    }
    setDismissed(true);
    window.dispatchEvent(new Event("ht-inbox-display-change"));
  };

  if (!mounted || !visible) return null;

  if (mbl) {
    return (
      <div className="flex w-full shrink-0 flex-col border-b border-border-light-gray-thin bg-hover-active px-4 pb-1.5 pt-2.5">
        <div className="flex items-start gap-2.5">
          <Bell
            aria-hidden
            className="mt-[2px] shrink-0 text-hypertasks-green"
            size={16}
            strokeWidth={1.75}
          />
          <div className="min-w-0">
            <div className="text-dense font-semibold text-white-black">
              Turn on notifications
            </div>
            <p className="mt-[2px] text-dense text-text-light-gray">
              Tasks and @mentions won&apos;t reach you outside this list.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 pl-[26px]">
          <button
            type="button"
            className={cn(
              MOBILE_TARGET,
              "text-dense font-semibold text-hypertasks-green disabled:cursor-wait disabled:opacity-50"
            )}
            disabled={pending !== null}
            onClick={denied ? enableEmail : enablePush}
          >
            {denied ? "Get updates by email" : "Enable notifications"}
          </button>
          {!denied && (
            <button
              type="button"
              className={cn(
                MOBILE_TARGET,
                "text-meta text-text-light-gray disabled:cursor-wait disabled:opacity-50"
              )}
              disabled={pending !== null}
              onClick={enableEmail}
            >
              or by email
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss notification nudge"
            className={cn(MOBILE_TARGET, "ml-auto text-text-light-gray")}
            onClick={dismiss}
          >
            <X aria-hidden size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-light-gray-thin bg-hover-active px-4 py-2.5">
      <div className="flex min-w-0 basis-full flex-1 items-center gap-2.5 sm:basis-auto">
        <Bell
          aria-hidden
          className="shrink-0 text-hypertasks-green"
          size={16}
          strokeWidth={1.75}
        />
        <span className="min-w-0 text-dense text-white-black">
          <span className="font-semibold">Turn on notifications</span>
          <span className="text-text-light-gray">
            {" "}
            — tasks and @mentions won&apos;t reach you outside this list.
          </span>
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="text-dense font-semibold text-hypertasks-green underline-offset-2 hover:underline focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
          disabled={pending !== null}
          onClick={denied ? enableEmail : enablePush}
        >
          {denied ? "Get updates by email" : "Enable notifications"}
        </button>
        {!denied && (
          <button
            type="button"
            className="text-meta text-text-light-gray underline-offset-2 hover:text-white-black hover:underline focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
            disabled={pending !== null}
            onClick={enableEmail}
          >
            or get them by email
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss notification nudge"
          className="text-text-light-gray hover:text-white-black focus-visible:outline-none"
          onClick={dismiss}
        >
          <X aria-hidden size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
};

export default InboxNotifyNudge;
