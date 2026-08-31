"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FaInbox } from "react-icons/fa";
import { CiSearch } from "react-icons/ci";
import { Calendar, Sparkles, SquareKanban } from "lucide-react";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import useAppShellSurfaceShortcuts from "@/hooks/Homepage/useAppShellSurfaceShortcuts";
import { useGetNotificationCount } from "@/hooks/Inbox/useGetNotifications";
import { cn } from "@/utils/undoActions/helperFuncs";
import { shouldShowMobilePrimaryDock } from "./mobileShellVisibility";
import {
  clearMobileDockHeight,
  publishMobileDockHeight,
  releaseMobileDockHeight,
} from "./mobileDockHeight";

const mobileTabBarDockOwner = {};

interface MobileTabBarProps {
  currentUserId: number;
}

const MobileTabBar = ({ currentUserId }: MobileTabBarProps) => {
  const pathname = usePathname();
  const dockRef = useRef<HTMLElement>(null);
  const [currentDay, setCurrentDay] = useState(() => new Date().getDate());
  const { data: notificationCount } = useGetNotificationCount(currentUserId);
  const { navigateToBoard } = useAppShellSurfaceShortcuts({ listen: false });
  const { toggleAIChatInterface, showAiChatInterface, closeAIChatInterface } =
    useGlobalUIState();
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshDay = () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      const now = new Date();
      setCurrentDay(now.getDate());

      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = setTimeout(
        refreshDay,
        nextMidnight.getTime() - now.getTime(),
      );
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshDay();
    };

    refreshDay();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  // Hide the dock whenever the AI chat is open: it overlays the chat and covered
  // the composer with the keyboard up. Back (the gesture / Android button) now
  // closes the chat, so this no longer strands the user on a sheet with no way
  // out — which is why it previously had to stay visible while not typing.
  const hidden = !shouldShowMobilePrimaryDock(pathname) || showAiChatInterface;

  // The dock is a fixed overlay, so layout reserves its measured height rather
  // than a hard-coded number that drifts if the bar's height ever changes. While
  // it's hidden the reservation must read 0, or the AI composer keeps a dead gap
  // above the keyboard (a `null` render doesn't run this effect's cleanup).
  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      clearMobileDockHeight(root, mobileTabBarDockOwner);
      return;
    }
    const dock = dockRef.current;
    if (!dock) return;
    const publish = () =>
      publishMobileDockHeight(
        root,
        mobileTabBarDockOwner,
        `${dock.offsetHeight}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      releaseMobileDockHeight(root, mobileTabBarDockOwner);
    };
  }, [hidden, pathname]);

  if (hidden) return null;

  // AI chat is an overlay, not a route, so leaving it means closing it before
  // the tab navigates.
  const leaveChat = () => {
    if (showAiChatInterface) closeAIChatInterface();
  };

  const tabClassName = (active: boolean) =>
    cn(
      "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 text-micro",
      active ? "text-white-black" : "text-text-light-gray",
    );

  const onInbox = pathname?.startsWith("/inbox") ?? false;
  const onBoard = pathname?.startsWith("/project") ?? false;
  const onCalendar = pathname?.startsWith("/calendar") ?? false;
  const onSearch = pathname?.startsWith("/search") ?? false;

  return (
    <nav
      ref={dockRef}
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-border-light-gray-thin bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-16 items-stretch">
        <button
          type="button"
          aria-current={onBoard && !showAiChatInterface ? "page" : undefined}
          onClick={() => {
            leaveChat();
            navigateToBoard("board");
          }}
          className={tabClassName(onBoard && !showAiChatInterface)}
        >
          <SquareKanban size={20} strokeWidth={1.75} aria-hidden />
          <span>Board</span>
        </button>

        <Link
          href="/calendar"
          onClick={leaveChat}
          aria-current={onCalendar && !showAiChatInterface ? "page" : undefined}
          className={tabClassName(onCalendar && !showAiChatInterface)}
        >
          <span className="relative h-5 w-5" aria-hidden>
            <Calendar
              className="absolute inset-0"
              size={20}
              strokeWidth={1.75}
            />
            <span
              suppressHydrationWarning
              className="absolute inset-x-0 bottom-px text-center text-micro font-medium leading-none tabular-nums"
            >
              {currentDay}
            </span>
          </span>
          <span>Calendar</span>
        </Link>

        <Link
          href="/inbox"
          onClick={leaveChat}
          aria-current={onInbox && !showAiChatInterface ? "page" : undefined}
          className={tabClassName(onInbox && !showAiChatInterface)}
        >
          <span className="relative">
            <FaInbox size={20} aria-hidden />
            {notificationCount.unseen > 0 && (
              // Desktop's calm unread signal: a blue dot, no count.
              <span className="absolute -right-1 -top-1 h-[7px] w-[7px] rounded-full bg-[#51A4F1]" />
            )}
          </span>
          <span>Inbox</span>
        </Link>

        <button
          type="button"
          aria-pressed={showAiChatInterface}
          onClick={toggleAIChatInterface}
          className={tabClassName(showAiChatInterface)}
        >
          <Sparkles size={18} strokeWidth={1.75} aria-hidden />
          <span>AI</span>
        </button>

        <Link
          href="/search"
          onClick={leaveChat}
          aria-current={onSearch && !showAiChatInterface ? "page" : undefined}
          className={tabClassName(onSearch && !showAiChatInterface)}
        >
          <CiSearch size={20} aria-hidden />
          <span>Search</span>
        </Link>
      </div>
    </nav>
  );
};

export default MobileTabBar;
