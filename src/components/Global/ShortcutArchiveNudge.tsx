"use client";

import { useContext, useEffect } from "react";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  archiveShortcutNudgeAtom,
  currentUserAtom,
  showQuickTipsAtom,
} from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { SHORTCUT_NUDGES_FLAG } from "@/lib/flags/keys";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import {
  ARCHIVE_SHORTCUT_NUDGE_THRESHOLD,
  beginArchiveShortcutNudge,
  clearArchiveShortcutNudge,
  isTaskDetailPath,
} from "@/lib/notifications/archiveShortcutNudge";

export default function ShortcutArchiveNudge() {
  const pathname = usePathname();
  const isMobile = useContext(MobileViewContext);
  const flagEnabled = useFlag(SHORTCUT_NUDGES_FLAG);
  const currentUser = useRecoilValue(currentUserAtom);
  const [tipsEnabled, setTipsEnabled] = useRecoilState(showQuickTipsAtom);
  const [nudge, setNudge] = useRecoilState(archiveShortcutNudgeAtom);
  const accountId = typeof currentUser?.id === "number" ? currentUser.id : null;
  const onTaskPage = isTaskDetailPath(pathname);

  useEffect(() => {
    setNudge((current) => {
      if (accountId === null || !flagEnabled || !tipsEnabled) {
        return clearArchiveShortcutNudge(current, accountId);
      }
      if (current.accountId !== accountId) {
        return clearArchiveShortcutNudge(current, accountId);
      }
      if (current.stage === "showing" && !onTaskPage) {
        return clearArchiveShortcutNudge(current, accountId);
      }
      if (current.stage === "pending" && onTaskPage) {
        return beginArchiveShortcutNudge(current, accountId, Date.now());
      }
      return current;
    });
  }, [
    accountId,
    flagEnabled,
    nudge.accountId,
    nudge.stage,
    onTaskPage,
    setNudge,
    tipsEnabled,
  ]);

  useEffect(() => {
    if (nudge.stage !== "showing" || nudge.hideAt === null) return;
    const hideAt = nudge.hideAt;
    const timeout = window.setTimeout(
      () =>
        setNudge((current) =>
          current.stage === "showing" && current.hideAt === hideAt
            ? clearArchiveShortcutNudge(current, accountId)
            : current,
        ),
      Math.max(0, hideAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [accountId, nudge.hideAt, nudge.stage, setNudge]);

  if (
    accountId === null ||
    !flagEnabled ||
    !tipsEnabled ||
    !onTaskPage ||
    nudge.accountId !== accountId ||
    nudge.stage !== "showing"
  ) {
    return null;
  }

  const dismiss = () =>
    setNudge((current) => clearArchiveShortcutNudge(current, accountId));

  return (
    <div className="pointer-events-none fixed left-1/2 top-0 z-[120] -translate-x-1/2">
      <div
        className="shortcut-archive-nudge pointer-events-auto flex max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-2 rounded-b-[5px] bg-modalBackground px-4 py-2 text-dense text-white-black shadow-md sm:max-w-none sm:flex-nowrap sm:justify-start"
        role="region"
        aria-label="Keyboard shortcut tip"
      >
        <span aria-live="polite">
          Tip: press{" "}
          <kbd className="rounded-[2px] bg-active-modal-element px-1.5 py-0.5 text-micro font-semibold text-white-black">
            E
          </kbd>{" "}
          to archive. You used the mouse {ARCHIVE_SHORTCUT_NUDGE_THRESHOLD} times.
        </span>
        <button
          type="button"
          className="rounded-sm text-meta text-text-light-gray underline underline-offset-2 hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none"
          onClick={() => {
            setTipsEnabled(false);
            dismiss();
          }}
        >
          Turn off all tips
        </button>
        <button
          type="button"
          aria-label="Dismiss shortcut tip"
          className={`${isMobile ? MOBILE_TARGET : ""} rounded-sm text-text-light-gray hover:text-white-black focus-visible:bg-hover-active focus-visible:text-white-black focus-visible:outline-none`}
          onClick={dismiss}
        >
          <X aria-hidden="true" size={14} strokeWidth={1.5} />
        </button>
      </div>
      <style jsx>{`
        .shortcut-archive-nudge {
          animation: shortcut-archive-nudge-in 180ms ease-out;
        }
        @keyframes shortcut-archive-nudge-in {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .shortcut-archive-nudge {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
