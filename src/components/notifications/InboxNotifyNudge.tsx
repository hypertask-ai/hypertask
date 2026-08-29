"use client";

import { Bell, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useNotificationNudge } from "@/hooks/notifications/useNotificationNudge";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";

const DISMISS_KEY = "ht_inbox_notif_nudge_dismissed";

// Pinned row at the top of the inbox nudging users who have BOTH push and email
// off to enable either. Replaces the bottom promotion banner (HTPR-4518), which
// overlaid the composers on every surface; this lives where notifications
// actually live and never overlays anything. (HTPR-4676)
const InboxNotifyNudge = () => {
  const { bothOff, pushDenied, pending, enablePush, enableEmail } =
    useNotificationNudge();
  const mbl = useContext(MobileViewContext);
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);

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
      // Storage can be unavailable in restricted browser contexts.
    }
    setDismissed(true);
  };

  if (!mounted || !bothOff || dismissed) return null;

  // Mobile gets its own shape (HTPR-4721). The desktop row puts the message and
  // both actions on one line, which crushes the text at 390px, so the message
  // takes its own line and the actions sit under it at 44px targets. Same
  // trigger, same words, same green: only the layout differs.
  //
  // It was off on mobile because the extra height tipped the inbox into a second
  // scrollbar. The mobile shell CSS now bounds that container (min-height: 0 plus
  // a fixed height), so the list is the only scroller and the row is safe.
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
            onClick={pushDenied ? enableEmail : enablePush}
          >
            {pushDenied ? "Get updates by email" : "Enable notifications"}
          </button>
          {!pushDenied && (
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
      {/* Narrow desktop windows still wrap the actions below the message
          (basis-full) rather than crushing it; inline beside them on sm+. */}
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
          onClick={pushDenied ? enableEmail : enablePush}
        >
          {pushDenied ? "Get updates by email" : "Enable notifications"}
        </button>
        {!pushDenied && (
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
