import {
  isAiChatSidebarModeAtom,
  isXScrollOnKanbanAtom,
  showAIChatInterfaceAtom,
  showCommandsAtom,
  showQuickTipsAtom,
  appShellRailAtom,
  currentUserAtom,
} from "@/store";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Settings, X } from "lucide-react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { useAiChatMainContentLayout } from "@/hooks/MultiPages/AIChat/useAiChatMainContentLayout";
import Tooltip from "../Common/Tooltip";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getLearnTutorialStorageKey,
  isLearnTutorialEligiblePath,
} from "@/lib/tutorial/learnTutorialState";
import {
  HTCTipsConstants,
  InboxPageTipsConstants,
  KanbanTipsConstants,
  SearchPageTipsConstants,
  TaskDetailTipsConstants,
} from "./ConstantsQuickTips";
import { ITips } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import UnseenLogo from "@/assets/test.png";
import SeenLogo from "@/assets/output-onlinetools 1.png";
import Image from "next/image";
import { IAnnouncement } from "@/models/Announcements/model";
import KBDElement from "../Common/kbd";
import HTCLogo from "@/assets/HTC_without_text.png";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import AIWriterButton from "../Common/AIWriterButton";
import { useGlobalUIState } from "../ProviderGlobal/useGlobalUIState";
import { useSettingsNavigation } from "../Modals/Settings/settingsNavigation";
import { tooltipConfig } from "@/lib/configs/tooltip.config";
import { CLASS_NAME_CONSTANTS } from "@/lib/configs/general.config";

// Simple utility function for conditional classes
const cn = (...classes: (string | boolean | undefined)[]) =>
  classes.filter(Boolean).join(" ");

interface CircularActionButtonProps {
  /** Click handler for the button */
  onClick: () => void;
  /** Icon to display - can be React component or Image props */
  icon?:
  | React.ReactNode
  | {
    src: string;
    width: number;
    height: number;
    alt?: string;
  };
  /** Tooltip text */
  tooltipText?: string;
  /** Keyboard shortcut for tooltip */
  keyCombination?: string[];
  /** Tooltip position */
  tooltipPosition?: {
    left?: number;
    bottom?: number;
  };
  /** Additional CSS classes */
  className?: string;
  /** Whether to use padding for icons vs px for images */
  variant?: "icon" | "image";
  /** Custom element type */
  as?: "button" | "div";
  children?: React.ReactNode;
}

/**
 * Reusable Circular Action Button Component
 *
 * A consistent circular button with icon/image, tooltip, and hover effects.
 * Used throughout the bottom settings for various actions.
 *
 * @example
 * ```tsx
 * // With React icon
 * <CircularActionButton
 *   onClick={() => toggleSettings()}
 *   icon={<Settings size={20} className="text-white-black" />}
 *   tooltipText="Settings"
 *   keyCombination={["\\"]}
 *   tooltipPosition={{ left: -54, bottom: 30 }}
 * />
 *
 * // With image
 * <CircularActionButton
 *   onClick={() => toggleCommands()}
 *   icon={{ src: "/logo.png", width: 18, height: 14, alt: "" }}
 *   tooltipText="Commands"
 *   keyCombination={["CTRL", "K"]}
 *   variant="image"
 * />
 * ```
 */
const CircularActionButton: React.FC<CircularActionButtonProps> = ({
  onClick,
  icon,
  tooltipText,
  keyCombination,
  tooltipPosition = { left: -54, bottom: 30 },
  className,
  variant = "icon",
  as = "button",
  children,
}) => {
  const baseClasses = cn(
    "floating-action-button relative bg-active-elementBg group w-fit rounded-full self-end mb-[1rem] mr-[1rem] cursor-pointer",
    variant === "icon" ? "p-[6px]" : "px-[8px] py-[6px]",
    className
  );

  const renderIcon = () => {
    if (React.isValidElement(icon)) {
      return icon;
    } else if (typeof icon === "object" && icon && "src" in icon) {
      return (
        <Image
          src={icon.src}
          width={icon.width}
          height={icon.height}
          alt={icon.alt || ""}
        />
      );
    }
    return children;
  };

  const Component = as;

  return (
    <Component tabIndex={-1} className={baseClasses} onClick={onClick}>
      {renderIcon()}
      {tooltipText && (
        <Tooltip
          left={tooltipPosition.left!}
          bottom={tooltipPosition.bottom!}
          text={tooltipText}
          keyCombination={keyCombination || []}
        />
      )}
    </Component>
  );
};

const BottomSettings_QuickTips = ({
  announcements,
}: {
  announcements: any;
}) => {
  const mbl = useContext(MobileViewContext);
  const pathname = usePathname();
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const isApple = useDeviceContext();
  const { effectiveTheme } = useDarkMode();
  const [showAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [isSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
  const { sidebarRightOffsetPx } = useAiChatMainContentLayout();
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !mbl;

  // ------------------------ centralized UI state management
  const {
    toggleAIChatInterface,
    toggleAnnouncements: toggleShowAnnouncements,
  } = useGlobalUIState();
  const { openSettings } = useSettingsNavigation();

  const { data: userPrefs } = useGetUserPreferences();
  const isAnnouncementUnread = useMemo(
    () =>
      !userPrefs?.muteAnnouncements &&
      announcements?.some((ann: IAnnouncement) => !ann.readAt),
    [announcements, userPrefs?.muteAnnouncements]
  );
  if (
    pathname?.startsWith("/onboarding") ||
    pathname?.startsWith("/trial-plan-confirmation") ||
    pathname?.startsWith("/login")
  )
    return <></>;

  // Mobile reaches settings through the avatar in MobileTopBar, so the
  // floating gear would be a second entry to the same place.
  if (mbl) return <></>;

  return (
    <>
      {!appShellRailOn &&
        (!showAiChatInterface || (showAiChatInterface && isSidebarMode)) && (
        <div
          style={{
            bottom: `calc(40px + var(--notif-banner-h, 0px))`,
            right: sidebarRightOffsetPx,
          }}
          className={`h-fit flex flex-col fixed z-[100] w-fit`}
        >
          {/* =========== announcement =========== */}
          <div
            onClick={toggleShowAnnouncements}
            className={`flex ${isAnnouncementUnread ? "pl-2 py-1 pr-1" : "p-1"
              } items-center  cursor-pointer rounded-full bg-active-elementBg w-fit  self-end mr-[1rem] mb-[0.75rem]`}
          >
            {isAnnouncementUnread ? (
              <span className="ml-1 text-white-black text-content">New</span>
            ) : (
              <></>
            )}
            <Image
              src={isAnnouncementUnread ? UnseenLogo.src : SeenLogo.src}
              alt=""
              className="text-white-black   "
              height={24}
              width={24}
            />
          </div>
          {!showAiChatInterface && (
            <CircularActionButton
              onClick={toggleAIChatInterface}
              className="p-0 !w-[34px] h-[34px]"
              tooltipPosition={tooltipConfig.settings.ai_chat_button}
            >
              <AIWriterButton
                className="floating-ai-icon p-[4px]"
                onToggle={toggleAIChatInterface}
                tooltipPosition={tooltipConfig.settings.ai_chat_button}
                customKeyCombination={[
                  `${!isApple ? "CTRL" : "CMD"}`,
                  "SHIFT",
                  "?",
                ]}
                tooltipText="AI Chat"
              />
            </CircularActionButton>
          )}

          {/* =========== HTC button ============ */}
          <CircularActionButton
            className={CLASS_NAME_CONSTANTS.BOTTOM_HTC}
            onClick={toggleShowCommands}
            icon={{
              src: effectiveTheme
                ? effectiveTheme !== "dark"
                  ? HTCLogo.src
                  : "/loginLogoMain.png"
                : "/loginLogoMain.png",
              width: 18,
              height: 14,
              alt: "",
            }}
            tooltipText="Hypertask Command"
            keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "K"]}
            tooltipPosition={tooltipConfig.settings.htc_button}
            variant="image"
          />

          {/* =========== GearIcon ============ */}
          <CircularActionButton
            onClick={() => openSettings()}
            className="right-sidebar-toggle"
            icon={
              <Settings size={20} strokeWidth={1.75} fill="none" className="text-white-black" />
            }
            tooltipText="Settings"
            keyCombination={["\\"]}
            tooltipPosition={tooltipConfig.settings.gear_button}
          />
        </div>
      )}

      {!mbl && <QuickTips />}
    </>
  );
};

export const QuickTips = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tutorialRequested = searchParams?.get("tutorial") === "1";
  const [tutorialStored, setTutorialStored] = useState(false);
  const currentUser = useRecoilValue(currentUserAtom);
  const storageKey = currentUser?.id
    ? getLearnTutorialStorageKey(currentUser.id)
    : null;
  const tutorialEligible = isLearnTutorialEligiblePath(pathname ?? "");
  const mbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !mbl;
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const [showQuickTips, setShowQuickTips] = useRecoilState(showQuickTipsAtom);
  useEffect(() => {
    setTutorialStored(
      Boolean(storageKey && window.sessionStorage.getItem(storageKey)),
    );
  }, [pathname, storageKey, tutorialRequested]);

  const tutorialActive =
    tutorialEligible && (tutorialRequested || tutorialStored);
  if (tutorialActive) return <></>;
  if (!showQuickTips) return <></>;

  function toggleQuickTips() {
    setShowQuickTips(false);
  }

  // console.log("🚀 ~ QuickTips ~ pathname:", pathname)
  if (showCommands.show) {
    return (
      <TipsComp tips={HTCTipsConstants} toggleQuickTips={toggleQuickTips} appShellRailOn={appShellRailOn} />
    );
  }
  // /demo is the anonymous kanban board, so it gets the same board tips.
  if (pathname?.startsWith("/project") || pathname?.startsWith("/demo")) {
    return (
      <TipsComp tips={KanbanTipsConstants} toggleQuickTips={toggleQuickTips} appShellRailOn={appShellRailOn} />
      // <></>￼Get started
    );
  } else if (pathname?.startsWith("/detail")) {
    return (
      <TipsComp
        tips={TaskDetailTipsConstants}
        toggleQuickTips={toggleQuickTips}
        appShellRailOn={appShellRailOn}
      />
    );
  } else if (pathname?.startsWith("/search")) {
    return (
      <TipsComp
        tips={SearchPageTipsConstants}
        toggleQuickTips={toggleQuickTips}
        appShellRailOn={appShellRailOn}
      />
    );
  } else if (pathname?.startsWith("/inbox")) {
    return (
      <TipsComp
        tips={InboxPageTipsConstants}
        toggleQuickTips={toggleQuickTips}
        appShellRailOn={appShellRailOn}
      />
    );
  } else return <></>;
};

export const TipsComp = ({
  tips,
  toggleQuickTips,
  appShellRailOn = false,
}: {
  tips: ITips[];
  toggleQuickTips: () => void;
  appShellRailOn?: boolean;
}) => {
  const isApple = useDeviceContext();
  const barRef = useRef<HTMLDivElement>(null);
  const pathanme = usePathname();
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const { mainContentWidth } = useAiChatMainContentLayout();
  const [hasHorizontalScrollbar, setHasHorizontalScrollbar] = useRecoilState(
    isXScrollOnKanbanAtom
  );
  useEffect(() => {
    if (!barRef.current) return;

    const bar = barRef.current;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--quick-tips-h",
        `${bar.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bar);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--quick-tips-h");
    };
  }, []);

  const renderShortcut = (x: string) => {
    if (x.toLowerCase() === "ctrl") {
      if (isApple) return "CMD";
      else return "CTRL";
    } else return x;
  };

  return (
    <div
      ref={barRef}
      style={{
        bottom: `calc(${
          appShellRailOn
            ? 0
            : hasHorizontalScrollbar && pathanme?.startsWith("/project")
            ? 12
            : 0
        }px + var(--notif-banner-h, 0px))`,
        position: "fixed",
        zIndex: 299,
        // Start after the left rail: the strip must never cover the rail's
        // bottom (gear/settings entry) — the rail no longer pads for it.
        left: appShellRailOn ? "var(--app-shell-rail-w, 48px)" : 0,
        width: appShellRailOn
          ? `calc(${mainContentWidth === "100%" ? "100%" : mainContentWidth} - var(--app-shell-rail-w, 48px))`
          : mainContentWidth,
      }}
      className={`quick-tips-bar xs:hidden lg:flex bg-active-list-element  p-2 items-center text-content ${pathanme?.startsWith("/project") ? "mb-0" : "mb-0"
        } py-[2px]'`}
    >
      <div
        className="flex justify-center items-center flex-1 min-w-0 flex-nowrap overflow-hidden whitespace-nowrap gap-[2px]"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)",
        }}
      >
        {tips.map((tip, index) => (
          <React.Fragment key={`${tip.startText ?? ""}-${tip.hint}-${index}`}>
            {tip.startText && (
              <span className="text-white-black first-letter:capitalize font-normal text-content leading-[21px] mr-1">
                {tip.startText}
              </span>
            )}
            <div
              className={`flex items-center justify-center gap-[8px] ${
                tip.hint === "command center"
                  ? "cursor-pointer hover:opacity-80"
                  : ""
              }`}
              onClick={
                tip.hint === "command center" ? toggleShowCommands : undefined
              }
            >
              {tip.key && tip.key.length > 0 && (
                <div
                  className="flex gap-[4px] items-center justify-center"
                >
                  {tip.key.map((tKey, tIndex) => (
                    <KBDElement
                      key={`${tIndex}-quicktips`}
                      className={`dark:bg-[#95999E] py-auto px-[6.25px] text-meta leading-[14px] font-semibold h-[20px] flex items-center justify-center mx-[0px] pt-[0px]`}
                      content={renderShortcut(tKey)}
                    />
                  ))}
                </div>
              )}
              <span className=" text-white-black first-letter:capitalize font-normal text-content leading-[21px]">
                {tip.hint}
              </span>
            </div>
            {index < tips.length - 1 && (
              <div className="bg-[#8E9093] h-[4px] w-[4px] rounded-full mx-[4px]" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* "Learn the keyboard" button hidden until the interactive tutorial is
          revamped (HTPR-4974). It pointed at /interactive-onboarding/landing;
          the Ctrl+K "Interactive tutorial" entry still reaches it for testing. */}

      <X size={18}
        className="cursor-pointer text-white-black text-subheading font-bold"
        onClick={toggleQuickTips}
        strokeWidth={1.75}
      />
    </div>
  );
};

export default BottomSettings_QuickTips;
