"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Inbox,
  LogIn,
  Timer,
} from "lucide-react";
import {
  IconoirCalendar,
  IconoirChat,
  IconoirKanban,
  IconoirRocket,
  IconoirRows,
  IconoirSearch,
  IconoirSettings,
  IconoirSidebar,
  IconoirSparks,
  IconoirUserPlus,
} from "@/components/Common/IconoirIcons";
import globalConstants from "@/lib/constants";
import { IProject, IUser } from "@/models/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import Tooltip from "@/components/Common/Tooltip";
import SearchTasksHeader from "./SearchFilterIcon";
import {
  appShellRailExpandedAtom,
  boardLayoutAtom,
  showCommandsAtom,
  showGuestLoginAtom,
} from "@/store";
import { useRecoilState, useSetRecoilState } from "@/lib/state";
import { CommandMode } from "@/models/enums";
import useAppShellSurfaceShortcuts, {
  RAIL_TOGGLE_KEY,
} from "@/hooks/Homepage/useAppShellSurfaceShortcuts";
import { useGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { IAnnouncement } from "@/models/Announcements/model";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchInboxQuery } from "@/hooks/Inbox/useGetNotifications";

const FeedbackModal = dynamic(
  () => import("@/components/Modals/Feedback/FeedbackModal")
);

interface AppShellRailProps {
  variant: "board" | "global";
  currentUser: IUser;
  currentProject?: IProject | null;
  notificationsCount?: number;
  notificationsUnseen?: number;
}

const RailItem = ({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label?: string;
  wide?: boolean;
}) => (
  <div
    className={
      wide
        ? // ponytail: the label rides on top of the existing full-width button
          // (pointer-events-none) so the whole row stays clickable without
          // editing every item; the !overrides pull the icon back to the left.
          "relative flex h-[34px] w-full items-center rounded-[5px] hover:bg-hover-active [&>*]:!justify-start [&>*]:!pl-[10px]"
        : "flex h-[34px] w-[36px] items-center justify-center rounded-[5px] hover:bg-hover-active"
    }
  >
    {children}
    {wide && label && (
      <span className="pointer-events-none absolute left-[38px] text-content text-text-light-gray">
        {label}
      </span>
    )}
  </div>
);

const AppShellRail = ({
  variant,
  currentUser,
  currentProject,
  notificationsUnseen = 0,
}: AppShellRailProps) => {
  const isApple = useDeviceContext();
  const pathname = usePathname();
  const router = useRouter();
  const { toggleAIChatInterface, toggleAnnouncements, toggleLeftSidebar } =
    useGlobalUIState();
  const boardProject = variant === "board" ? currentProject : null;
  const [boardLayout] = useRecoilState(boardLayoutAtom);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const setShowLogin = useSetRecoilState(showGuestLoginAtom);
  const { navigateToBoard } = useAppShellSurfaceShortcuts({ listen: false });
  const { openSettings } = useSettingsNavigation();
  const [showFeedback, setShowFeedback] = useState(false);
  const { data: announcementsData } =
    useGetAnnouncements(currentUser.id);
  const announcements = useMemo(
    () => (Array.isArray(announcementsData) ? announcementsData as IAnnouncement[] : []),
    [announcementsData]
  );
  const { data: userPrefs } = useGetUserPreferences();
  const queryClient = useQueryClient();
  const prefetchInbox = useCallback(() => {
    void prefetchInboxQuery(queryClient, currentUser.id);
  }, [currentUser.id, queryClient]);
  // HTPR-4890: every user gets the expanded rail (labels, 130px), collapsible
  // back to the icon-only 48px rail. Only the signup CTAs stay guest-only.
  const [isGuest, setIsGuest] = useState(false);
  const [expanded, setExpanded] = useRecoilState(appShellRailExpandedAtom);
  const wide = expanded;
  // Tooltip `left` is measured from the row button, whose left edge sits 6px in
  // from the rail edge in BOTH states (px-1.5 expanded; the 36px item centred in
  // 48px collapsed). So clearing the rail entirely = railWidth + gap - 6, with a
  // 12px gap: 130 + 12 - 6 = 136 expanded, 48 + 12 - 6 = 54 collapsed.
  const tooltipLeft = wide ? 136 : 54;

  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  // Page content offsets by var(--app-shell-rail-w, 48px); keep it in sync.
  // useLayoutEffect (not useEffect) so this commits before the browser's first
  // paint of this mount — otherwise every page relying on the fallback value
  // (48px) paints with the wrong padding for a frame, then visibly slides to
  // the real width once the effect catches up (HTPR-5725).
  // No unmount cleanup: AppShellRail remounts fresh on every page (it's not in
  // a persistent layout), and clearing the var on unmount reopened the same
  // fallback-then-correct gap across a page transition that spans two paints
  // (e.g. a loading/suspense boundary). Every reader of this var is already
  // gated behind the same page's own rail-on flag, so a value left over from
  // the previous page is never read before the next AppShellRail overwrites it.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--app-shell-rail-w",
      wide ? "130px" : "48px",
    );
  }, [wide]);

  const isAnnouncementUnread = useMemo(
    () =>
      !userPrefs?.muteAnnouncements &&
      announcements.some((announcement) => !announcement.readAt),
    [announcements, userPrefs?.muteAnnouncements]
  );

  const onCalendar = pathname?.startsWith("/calendar");
  const onBoard = pathname?.startsWith("/project");
  const onInbox = pathname?.startsWith("/inbox");
  const onSearch = pathname?.startsWith("/search");
  // /timers redirects to /time?running=1 in next.config, so the rail never sees
  // the /timers path. Match the destination instead (HTPR-4774).
  const onTimers = pathname?.startsWith("/time");
  const onAgents = pathname?.startsWith("/agents");

  return (
    <>
    {/* ponytail: below ~540px the rail scrolls instead of clipping its bottom
        cluster; hover tooltips get clipped there (overflow container), which is
        the accepted trade for keeping every button reachable (HTPR-4837). */}
    <aside
      // app-shell-rail: stable className for theme CSS to target (border
      // color per theme, HTPR-4906). z-[60] is unchanged: the actual bug was
      // a stray z-100 on the inbox/trash/onboarding scroll containers
      // (normal-flow wrappers that had no business being z-indexed at all),
      // removed at the source rather than out-escalated here.
      className={`app-shell-rail fixed left-0 top-0 z-[60] flex h-[100svh] flex-col border-r-[1.3px] border-light-black-border-1 bg-containerBackground py-2 [@media(max-height:540px)]:overflow-y-auto scrollbar-none ${
        wide ? "w-[130px] items-stretch px-1.5" : "w-[48px] items-center"
      }`}
    >
      <button
        tabIndex={-1}
        onClick={() => setExpanded((prev) => !prev)}
        className={`group relative mb-1 flex h-[20px] items-center text-text-light-gray hover:text-white-black ${
          wide ? "justify-end pr-1" : "justify-center"
        }`}
        aria-label={wide ? "Collapse sidebar" : "Expand sidebar"}
      >
        {wide ? <ChevronLeft size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
        <Tooltip
          left={tooltipLeft}
          bottom={-8}
          text={wide ? "Collapse sidebar" : "Expand sidebar"}
          keyCombination={[RAIL_TOGGLE_KEY]}
        />
      </button>
      {/* Board switcher sits alone on top: Ctrl+B family, not the 1-9 row below. */}
      <div className={`flex flex-col gap-1 ${wide ? "w-full" : "items-center"}`}>
        <RailItem wide={wide} label="Boards">
          <button
            tabIndex={-1}
            onClick={toggleLeftSidebar}
            className="group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black"
            aria-label="Your Kanban boards"
          >
            <IconoirSidebar size={18} strokeWidth={1.5} />
            <Tooltip
              left={tooltipLeft}
              bottom={-8}
              text="Switch board"
              keyCombination={[isApple ? "CMD" : "CTRL", "B"]}
            />
          </button>
        </RailItem>
      </div>

      <div className={`mt-3 flex flex-col gap-1 ${wide ? "w-full" : "items-center"}`}>
        <RailItem wide={wide} label="Inbox">
          <Link
            tabIndex={-1}
            className={`group relative flex h-full w-full cursor-pointer items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
              onInbox ? "bg-hover-active !text-white-black" : ""
            }`}
            href="/inbox"
            aria-label="Go to inbox"
            onPointerEnter={prefetchInbox}
            onFocus={prefetchInbox}
            onTouchStart={prefetchInbox}
          >
            <span className="relative flex h-5 w-5 items-center justify-center">
              <Inbox size={18} strokeWidth={1.5} />
              {notificationsUnseen > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-[6px] w-[6px] rounded-full bg-[#51A4F1]" />
              )}
            </span>
            <Tooltip left={tooltipLeft} bottom={-8} text="Go to inbox" keyCombination={["1"]} />
          </Link>
        </RailItem>
        <RailItem wide={wide} label="Board">
          <button
            tabIndex={-1}
            onClick={() => navigateToBoard("board")}
            className={`group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
              onBoard && boardLayout === "board" ? "bg-hover-active !text-white-black" : ""
            }`}
            aria-label="Board layout"
          >
            <IconoirKanban size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Board layout" keyCombination={["2"]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="Table">
          <button
            tabIndex={-1}
            onClick={() => navigateToBoard("table")}
            className={`group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
              onBoard && boardLayout === "table" ? "bg-hover-active !text-white-black" : ""
            }`}
            aria-label="Table layout"
          >
            <IconoirRows size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Table layout" keyCombination={["3"]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="Calendar">
          <button
            tabIndex={-1}
            onClick={() => router.push("/calendar")}
            className={`group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
              onCalendar ? "bg-hover-active !text-white-black" : ""
            }`}
            aria-label="Go to calendar"
          >
            <IconoirCalendar size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Go to calendar" keyCombination={["4"]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="AI Chat">
          {/* Plain full-width button like the sibling rows: RailItem's expanded
              label overlay assumes its child fills the row, and AIWriterButton's
              content-sized span left the "AI Chat" row dead outside the icon. */}
          <button
            tabIndex={-1}
            onClick={toggleAIChatInterface}
            className="group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black"
            aria-label="AI Chat"
          >
            <IconoirSparks size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="AI Chat" keyCombination={["5"]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="Search">
          {boardProject ? (
            <SearchTasksHeader
              className="h-full w-full justify-center rounded-[5px] text-text-light-gray hover:text-white-black"
              icon={<IconoirSearch size={18} strokeWidth={1.5} />}
              tooltipPosition={{ left: tooltipLeft, bottom: -8 }}
              keyCombination={["6"]}
            />
          ) : (
            <button
              tabIndex={-1}
              onClick={() => router.push("/search")}
              className={`group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
                onSearch ? "bg-hover-active !text-white-black" : ""
              }`}
              aria-label="Search"
            >
              <IconoirSearch size={18} strokeWidth={1.5} />
              <Tooltip left={tooltipLeft} bottom={-8} text="Search" keyCombination={["6"]} />
            </button>
          )}
        </RailItem>
        {boardProject?.timeTrackingEnabled && (
          <RailItem wide={wide} label="Timers">
            <button
              tabIndex={-1}
              onClick={() => router.push(globalConstants.timersRoute)}
              className={`group relative flex h-full w-full items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
                onTimers ? "bg-hover-active !text-white-black" : ""
              }`}
              aria-label="Running timers"
            >
              <Timer size={18} strokeWidth={1.5} />
              <Tooltip left={tooltipLeft} bottom={-8} text="Running timers" keyCombination={["7"]} />
            </button>
          </RailItem>
        )}
      </div>

      <div className={`mt-auto flex flex-col gap-1 pb-1 ${wide ? "w-full" : "items-center"}`}>
        <RailItem wide={wide} label="Agents">
          <Link
            tabIndex={-1}
            href="/agents"
            className={`group relative flex h-full w-full cursor-pointer items-center justify-center rounded-[5px] text-text-light-gray hover:text-white-black ${
              onAgents ? "bg-hover-active !text-white-black" : ""
            }`}
            aria-label="Agents"
          >
            <Bot size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Agents" keyCombination={[]} />
          </Link>
        </RailItem>
        <RailItem wide={wide} label="Invite">
          <button
            tabIndex={-1}
            onClick={() => setShowCommands({ show: true, mode: CommandMode.InviteMember })}
            className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black"
            aria-label="Invite team members"
          >
            <IconoirUserPlus size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Invite team members" keyCombination={[]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="News">
          <button
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleAnnouncements}
            className={`group relative flex h-full w-full items-center justify-center hover:text-white-black ${
              isAnnouncementUnread ? "text-white-black" : "text-text-light-gray"
            }`}
            aria-label="Latest updates"
          >
            {/* Something new = brighten the icon (no colored dot; stays a tier below the inbox). */}
            <span className="relative flex h-5 w-5 items-center justify-center">
              <IconoirRocket size={18} strokeWidth={1.5} />
            </span>
            <Tooltip left={tooltipLeft} bottom={-8} text="Latest updates" keyCombination={[]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="Feedback">
          <button
            tabIndex={-1}
            onClick={() => setShowFeedback(true)}
            className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black"
            aria-label="Send feedback"
          >
            <IconoirChat size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Send feedback" keyCombination={[]} />
          </button>
        </RailItem>
        <RailItem wide={wide} label="Settings">
          <button tabIndex={-1} onClick={() => openSettings()} className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black">
            <IconoirSettings size={18} strokeWidth={1.5} />
            <Tooltip left={tooltipLeft} bottom={-8} text="Settings" keyCombination={["\\"]} />
          </button>
        </RailItem>

        {/* HTPR-4883: the guest signup CTAs live here, not in the tips bar.
            The mt-5 gap is what separates them from the nav items above — a
            divider line would break the no-outlines rule. */}
        {isGuest &&
          (wide ? (
            <div className="mt-5 flex w-full flex-col gap-1">
              <button
                type="button"
                onClick={() => setShowLogin(true)}
                className="w-full rounded-[5px] py-1 text-left pl-[10px] text-content font-medium text-text-light-gray hover:text-white-black"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => setShowLogin(true)}
                className="w-full rounded-[5px] bg-white-black py-1 !text-left pl-[10px] text-content font-medium text-white-black-inverted hover:opacity-90"
              >
                Sign up for free
              </button>
              <a
                href="https://hypertask.ai/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-[5px] py-1 text-left pl-[10px] text-content font-medium text-text-light-gray hover:text-white-black"
              >
                Pricing
              </a>
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-1">
              <RailItem>
                <button
                  tabIndex={-1}
                  onClick={() => setShowLogin(true)}
                  className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black"
                  aria-label="Log in"
                >
                  <LogIn size={18} strokeWidth={1.5} />
                  <Tooltip left={tooltipLeft} bottom={-8} text="Log in" keyCombination={[]} />
                </button>
              </RailItem>
              <RailItem>
                <button
                  tabIndex={-1}
                  onClick={() => setShowLogin(true)}
                  className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black"
                  aria-label="Sign up for free"
                >
                  <IconoirUserPlus size={18} strokeWidth={1.5} />
                  <Tooltip left={tooltipLeft} bottom={-8} text="Sign up for free" keyCombination={[]} />
                </button>
              </RailItem>
              <RailItem>
                <a
                  tabIndex={-1}
                  href="https://hypertask.ai/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative flex h-full w-full items-center justify-center text-text-light-gray hover:text-white-black"
                  aria-label="Pricing"
                >
                  <CreditCard size={18} strokeWidth={1.5} />
                  <Tooltip left={tooltipLeft} bottom={-8} text="Pricing" keyCombination={[]} />
                </a>
              </RailItem>
            </div>
          ))}
      </div>
    </aside>
    {showFeedback && (
      <FeedbackModal closeHandler={() => setShowFeedback(false)} />
    )}
    </>
  );
};

export default AppShellRail;
