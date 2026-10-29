
"use client";
import { useAiChatAutoOpen } from "@/hooks/General/useAiChatAutoOpen";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG, HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG, HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG } from "@/lib/flags/keys";
import {
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useContext,
} from "react";
import { Toaster } from "react-hot-toast";
import { SINGLE_UNDO_TOASTER_ID, SingleUndoToaster } from "@/components/undoToast";
import { useMobileToastAutoDismiss } from "@/components/undoToast/useMobileToastAutoDismiss";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { KeyCodes, KeyValues } from "@/lib/constants/keyboard-handler";
import { useQueryClient } from "@tanstack/react-query";
import { useInboxEFirstPressQueue } from "@/hooks/useInboxEFirstPressQueue";
import { IProject } from "@/models/model";
import CachedTaskDetailNavigation from "@/components/PageComponents/TaskDetail/CachedTaskDetailNavigation";

import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import {
  showBoardManagerAtom,
  showShortcutsAtom,
  showGuestLoginAtom,
  showCommandsAtom,
  showCreateTaskModalAtom,
  showScrollSettingModalAtom,
  showMcpTokenModalAtom,
  announcementSlideAtom,
  aiChatExplicitOpenAtAtom,
  aiChatAutoOpenSuppressedAtom,
  aiChatPinnedAtom,
  openAiChatByDefaultAtom,
  keepAiChatClosedAtom,
  showAIChatInterfaceAtom,
  isAiChatSidebarModeAtom,
  mobileCommentComposerOpenAtom,
  showAccountSwitcherAtom,
  appShellRailAtom,
  currentUserAtom,
  currentProjectAtom,
  lastUsedBoardsAtom,
  agentChatTeamCycleAtom,
  agentChatMobileFullscreenAtom,
} from "@/store";
import { orderTeamsForSwitcher } from "@/lib/teamSwitcherOrder";
import { getLastBoardTeam, setLastBoardTeam } from "@/lib/lastBoardTeam";

const SwitchAccountModal = dynamic(
  () => import("@/components/Modals/commands/SwitchAccount/SwitchAccountModal"),
  { ssr: false },
);
const RightSidebar = dynamic(
  () => import("@/components/sidebars/RightSidebar"),
  {
    ssr: false,
  },
);
const LeftSidebar = dynamic(() => import("@/components/sidebars/leftSidebar"), {
  ssr: false,
});
const KeyboardShortcuts = dynamic(
  () => import("@/components/sidebars/keyboardShortcuts"),
  { ssr: false },
);
const GuestLoginModal = dynamic(
  () => import("@/components/Modals/GuestLoginModal"),
  { ssr: false },
);
const GuestAuthLinks = dynamic(
  () => import("../PageComponents/Kanban/HeaderComponents/GuestAuthLinks"),
  { ssr: false },
);
const AnnouncementSlideModal = dynamic(
  () => import("../Modals/AnnouncementSlide/AnnouncementSlide"),
  { ssr: false },
);
const AnnouncementBanner = dynamic(
  () => import("../Modals/AnnouncementBanner/AnnouncementBanner"),
  { ssr: false },
);
const MobileBlockingOverlay = dynamic(
  () =>
    import("../Modals/MobileBlockingOverlay/MobileBlockingOverlay").then(
      (module) => module.MobileBlockingOverlay,
    ),
  { ssr: false },
);
const EmailVerificationModal = dynamic(
  () => import("../Modals/EmailVerificationModal"),
  { ssr: false },
);
const MobileTabBar = dynamic(() => import("../Global/MobileTabBar"), {
  ssr: false,
});
const MobileCreateTaskButton = dynamic(
  () => import("../Global/MobileCreateTaskButton"),
  { ssr: false },
);
const MobilePullDownCommand = dynamic(
  () => import("../Global/MobilePullDownCommand"),
  { ssr: false },
);
const MobileTopBar = dynamic(() => import("../Global/MobileTopBar"), {
  ssr: false,
});
const HypertasksCommands = dynamic(() => import("../commands"), {
  ssr: false,
});
const BottomSettingsQuickTips = dynamic(
  () => import("../Global/BottomSettings_QuickTips"),
  { ssr: false },
);
const ShortcutArchiveNudge = dynamic(
  () => import("../Global/ShortcutArchiveNudge"),
  { ssr: false },
);
const NotificationPromoteBanner = dynamic(
  () => import("../Global/NotificationPromoteBanner"),
  { ssr: false },
);
const CookieConsentBanner = dynamic(
  () => import("../Global/CookieConsentBanner"),
  { ssr: false },
);
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import globalConstants from "@/lib/constants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { isFavoriteBoardShortcut } from "@/lib/constants/shortcuts";
import { isControlQFocusShortcut } from "@/lib/aiChat/chatFocusShortcut";
import { shouldRenderGlobalCommandMenu } from "@/lib/constants/commandCenterShortcut";
import { useCommandCenterShortcut } from "@/hooks/General/useCommandCenterShortcut";
import { usePageLoadReservations } from "@/hooks/General/usePageLoadReservations";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useGlobalUIState } from "./useGlobalUIState";
import { useSettingsNavigation } from "@/components/Modals/Settings/settingsNavigation";
import {
  getLearnTutorialStorageKey,
  LEARN_TUTORIAL_STORAGE_KEY,
} from "@/lib/tutorial/learnTutorialState";

const CreateTaskGlobally = dynamic(
  () => import("../Modals/CreateTaskGloballyModal"),
  {
    ssr: false,
  },
);
const ScrollSettings = dynamic(
  () => import("../Modals/ScrollSettings/ScrollSettings"),
  {
    ssr: false,
  },
);
const McpTokenModal = dynamic(
  () => import("../Modals/McpToken/McpTokenModal"),
  { ssr: false },
);
const Announcements = dynamic(() => import("../sidebars/Announcements"), {
  ssr: false,
});
const ReactQueryDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic<{ initialIsOpen?: boolean }>(
        () =>
          import("@tanstack/react-query-devtools").then(
            (mod) => mod.ReactQueryDevtools,
          ),
        { ssr: false },
      )
    : null;
import useGlobalPathCheck from "@/hooks/General/useGlobalPathCheck";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { markBoardSwitchIntent } from "@/lib/analytics/boardSwitchLatency";
import { boardFromDeviceFirst, boardFromFreshList } from "@/lib/keyboard/boardShortcutTarget";
import { HTPR_7588_BOARD_SHORTCUT_FROM_DEVICE_FLAG } from "@/lib/flags/definitions/htpr-7588-board-shortcut-from-device";
import { useEmojiFrequencyHydration } from "@/hooks/General/useEmojiFrequencyHydration";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useTaskBoxOutlinesFlag } from "@/hooks/useTaskBoxOutlinesFlag";
import { useInboxLegacyWarm } from "@/hooks/useInboxLegacyWarm";
import { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG } from "@/lib/flags/keys";
import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";

import AIChatClosedLayout from "../AI_CHAT/AI_Chat_Closed_Layout";
import FullScreenChatLoading from "../AI_CHAT/FullScreenChatLoading";
import ChatRuntimeHost from "./ChatRuntimeHost";
import {
  readChatOpenForSession,
  writeChatOpenForSession,
} from "@/lib/aiChat/chatOpenSession";
import {
  createGlobalGShortcutCapture,
  type GlobalGShortcutAction,
} from "@/lib/keyboard/globalGShortcuts";
import {
  areGlobalShortcutsEnabled,
  isGlobalCreateTaskShortcut,
} from "@/lib/keyboard/globalShortcutRoutes";
import useAppShellSurfaceShortcuts from "@/hooks/Homepage/useAppShellSurfaceShortcuts";
import { boardContextFromPath, buildSearchUrl } from "@/lib/searchArchive";

type AIChatLayoutModule = typeof import("../AI_CHAT/AI_Chat_Layout");
type ChatRuntimeModule = {
  default: (typeof import("@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context"))["ChatRuntime"];
};
let aiChatLayoutPromise: Promise<AIChatLayoutModule> | null = null;
let chatRuntimePromise: Promise<ChatRuntimeModule> | null = null;
const loadAIChatLayout = () => {
  if (!aiChatLayoutPromise) {
    aiChatLayoutPromise = import("../AI_CHAT/AI_Chat_Layout").catch((error) => {
      aiChatLayoutPromise = null;
      throw error;
    });
  }
  return aiChatLayoutPromise;
};
const loadChatRuntime = () => {
  if (!chatRuntimePromise) {
    chatRuntimePromise =
      import("@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context")
        .then((module) => ({ default: module.ChatRuntime }))
        .catch((error) => {
          chatRuntimePromise = null;
          throw error;
        });
  }
  return chatRuntimePromise;
};
const AIChatPanels = lazy(loadAIChatLayout);
const ChatRuntime = lazy(loadChatRuntime);

import {
  prefixUseGetAnnouncements,
  useGetAnnouncements,
} from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import {
  getAnnouncementSlides,
  getExplicitLevel,
  IAnnouncement,
} from "@/models/Announcements/model";
import axios from "axios";
import { CommandMode } from "@/models/enums";
import useGlobalProvider from "./useGlobalProvider";
import { useGetHyperAI } from "@/hooks/MultiPages/useGetHyperAI";
import globalAPIHandlers from "@/utils/api/global";
import { useInboxRealtime } from "@/hooks/realtime/useInboxRealtime";
import { useMobileBlocking } from "@/lib/contexts/mobileBlockingContext";
import useEmailVerificationModal from "@/hooks/GlobalProviders/useEmailVerificationModal";
import {
  keyboard_shortcuts,
  matchesShortcut,
} from "@/lib/utils/keyboardShortcuts";
import {
  shouldShowMobileCreateTaskButton,
  shouldEnableMobilePullDownCommand,
  isAgentChatPath,
} from "../Global/mobileShellVisibility";
import { BoardStartupContext } from "@/lib/contexts/boardStartupContext";
import {
  MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS,
  shouldShowMobileBoardControls,
} from "@/lib/boardStartup/mobileControls";
import { shouldEnableSecondaryStartup } from "@/lib/boardStartup/secondaryRequests";

const preventEscapeOnCommandModes: CommandMode[] = [
  CommandMode.AICustomInstruction,
];

const NO_INTERRUPTION_ROUTES = [
  "/login",
  "/invite",
  "/reset",
  "/pricing",
  "/oauth",
  "/cli-auth",
  "/share",
  "/(tutorial space)",
  "/full-plan-confirmation",
];

const NO_CHAT_RESTORE_ROUTES = [
  ...NO_INTERRUPTION_ROUTES,
  "/interactive-onboarding",
  "/onboarding",
  "/learn",
  "/new",
  "/settings",
  "/trial",
  "/trial-plan-confirmation",
  "/unauthorized",
  "/verify-email",
];

import { HTPR_7406_DESKTOP_SERVER_BOARD_FLAG } from "@/lib/flags/keys";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";

export default function GlobalProvider({
  children,
  authenticatedUserId,
}: {
  children: ReactNode;
  authenticatedUserId: number | null;
}) {
  useMobileToastAutoDismiss();
  useMobileToastAutoDismiss(SINGLE_UNDO_TOASTER_ID);
  useTaskBoxOutlinesFlag();
  const composeTaskWriterEnabled = useFlag("htpr-6929-compose-task-writer");
  const myTasksSingleCommandCenter = useFlag(HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG);
  const isApple = useDeviceContext();
  const mbl = useContext(MobileViewContext);
  const pathname = usePathname();
  const firstScreen = useFirstScreenSurface(authenticatedUserId);
  const routeOwnsMobileChrome = Boolean(firstScreen);
  let boardShortcutLookup = boardFromFreshList;
  if (useFlag(HTPR_7588_BOARD_SHORTCUT_FROM_DEVICE_FLAG)) boardShortcutLookup = boardFromDeviceFirst;
  useAppShellSurfaceShortcuts();
  const startupUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const projectRoute = pathname?.startsWith("/project") ?? false;
  const startupUserMatchesSession =
    authenticatedUserId !== null && startupUser?.id === authenticatedUserId;
  const startupAccountKey = authenticatedUserId ?? "anonymous";
  const [releasedStartupAccountKey, setReleasedStartupAccountKey] = useState<
    number | "anonymous" | null
  >(null);
  const [usableStartupAccountKey, setUsableStartupAccountKey] = useState<
    number | "anonymous" | null
  >(null);
  const [recoveredStartupAccountKey, setRecoveredStartupAccountKey] = useState<
    number | "anonymous" | null
  >(null);
  const secondaryStartupEnabled = shouldEnableSecondaryStartup({
    hasAuthenticatedUser: startupUserMatchesSession,
    projectRoute,
    releasedForAccount: releasedStartupAccountKey === startupAccountKey,
  });
  const boardUsable =
    !projectRoute || usableStartupAccountKey === startupAccountKey;
  const mobileBoardControlsReady = shouldShowMobileBoardControls({
    projectRoute,
    boardUsable,
    recoveryTimedOut: recoveredStartupAccountKey === startupAccountKey,
  });
  const releaseSecondaryStartup = useCallback(() => {
    if (projectRoute) setReleasedStartupAccountKey(startupAccountKey);
  }, [projectRoute, startupAccountKey]);
  const markBoardUsable = useCallback(() => {
    if (projectRoute) setUsableStartupAccountKey(startupAccountKey);
  }, [projectRoute, startupAccountKey]);
  useEffect(() => {
    if (!projectRoute || boardUsable) return;
    const timer = window.setTimeout(() => {
      setRecoveredStartupAccountKey(startupAccountKey);
    }, MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [boardUsable, projectRoute, startupAccountKey]);
  useEmojiFrequencyHydration(secondaryStartupEnabled);
  const router = useRouter();
  const { navigate } = useHypertasksNavigate();
  const { shouldShowMobileOverlay, userEmail, hideMobileOverlay } =
    useMobileBlocking();
  const {
    favorites,
    setCurrentProjectIndex,
    currentProjectIndex,
    currentUser,
    _currentProject,
  } = useGlobalProvider(secondaryStartupEnabled);

  const {
    resetShowCommands,
    toggleShowCommands,
    toggleCreateTaskGlobally,
    resetCreateTaskGlobally,
    GlobalProvidersEscapeHandler,
  } = useHypertasksRecoilStates();

  const {
    toggleAIChatInterface,
    openAIChatInterface,
    showAiChatInterface,
    closeAIChatInterface,
    toggleKeyboardShortcuts,
    toggleRightSidebar,
    showSidebar,
    toggleLeftSidebar,
    showAnnouncements,
    closeAnnouncements,
  } = useGlobalUIState();
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const aiChatAutoOpenSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
  const aiChatPinned = useRecoilValue(aiChatPinnedAtom);
  const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom);
  const { reserve: aiChatSwitchReserve } = useAiChatAutoOpen(mbl);
  let aiChatOpenSwitchesEnabled = !useFlagReady(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  if (useFlag(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG)) aiChatOpenSwitchesEnabled = true;
  const keepAiChatClosedEnabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const keepAiChatClosedReady = useFlagReady(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const savedKeepAiChatClosed = useRecoilValue(keepAiChatClosedAtom);
  const chatAutoOpenReady = !savedKeepAiChatClosed || keepAiChatClosedReady;
  let keepAiChatClosed = false;
  if (keepAiChatClosedEnabled) keepAiChatClosed = savedKeepAiChatClosed;
  const [reserveBoardChat, setReserveBoardChat] = useState(() =>
    firstScreen?.scope.route === "/project" && pathname?.startsWith("/project") === true &&
    firstScreen.flags.values[HTPR_7406_DESKTOP_SERVER_BOARD_FLAG] === true &&
    !aiChatOpenSwitchesEnabled && !mbl && authenticatedUserId !== null && chatAutoOpenReady && !keepAiChatClosed &&
    (aiChatPinned || (openAiChatByDefault && !aiChatAutoOpenSuppressed))
  );
  useEffect(() => {
    if (showAiChatInterface || !pathname?.startsWith("/project")) setReserveBoardChat(false);
  }, [showAiChatInterface, pathname]);
  const setShowAiChatInterface = useSetRecoilState(showAIChatInterfaceAtom);
  const { openSettings } = useSettingsNavigation();

  const [showBoardManager] = useRecoilState(showBoardManagerAtom);
  const [showShortcuts] = useRecoilState(showShortcutsAtom);
  const [showGuestLogin, setShowGuestLogin] =
    useRecoilState(showGuestLoginAtom);
  const [showAccountSwitcher, setShowAccountSwitcher] = useRecoilState(
    showAccountSwitcherAtom,
  );

  const [showAccouncementSlide, setShowAnnouncementSlide] = useRecoilState(
    announcementSlideAtom,
  );
  const [showCommands] = useRecoilState(showCommandsAtom);
  useEffect(() => {
    if ((showCommands as { show?: boolean })?.show) {
      setShowAccountSwitcher(false);
    }
  }, [showCommands, setShowAccountSwitcher]);
  const [showGlobalCreateHTCTask, ___________] = useRecoilState(
    showCreateTaskModalAtom,
  );
  const [showScrollSettings, setShowScrollSettings] = useRecoilState(
    showScrollSettingModalAtom,
  );
  const [showMcpTokenModal, setShowMcpTokenModal] = useRecoilState(
    showMcpTokenModalAtom,
  );
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;
  const isAgentChatPage = pathname?.startsWith("/agents/chat") ?? false;
  const isTaskDetailPage = pathname?.startsWith("/detail") ?? false;
  const shouldMountAgentChatRuntime =
    isAgentChatPage && mbl;
  const agentSidebarChatsEnabled = useFlag(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG);
  const manualChat = useFlag(HTPR_8088_MANUAL_CHAT_FLAG);
  const [sidebarRequested, setSidebarRequested] = useState(false);
  const setSidebarMode = useSetRecoilState(isAiChatSidebarModeAtom);
  const setAiChatAutoOpenSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
  useEffect(agentSidebarChatsEnabled ? () => {
    const requested = new URLSearchParams(window.location.search).has("agentSidebar");
    setSidebarRequested(requested);
    if (!requested) return;
    setSidebarMode(true);
    setAiChatAutoOpenSuppressed(false);
    setShowAiChatInterface(true);
  } : () => {
    setSidebarRequested(false);
  }, [agentSidebarChatsEnabled, pathname, setSidebarMode, setAiChatAutoOpenSuppressed, setShowAiChatInterface]);
  const [chatRuntimeMounted, setChatRuntimeMounted] = useState(
    isFullScreenChat || showAiChatInterface,
  );
  const hasAttemptedChatRestoreRef = useRef(false);
  const shouldMountChatRuntime =
    chatRuntimeMounted ||
    sidebarRequested ||
    isFullScreenChat ||
    shouldMountAgentChatRuntime ||
    isTaskDetailPage ||
    showAiChatInterface;
  useEffect(() => {
    if (!isTaskDetailPage) return;
    void Promise.all([loadChatRuntime(), loadAIChatLayout()]).catch(() => {});
  }, [isTaskDetailPage]);
  useEffect(() => {
    if (!currentUser?.id) return;
    window.sessionStorage.removeItem(
      getLearnTutorialStorageKey(currentUser.id),
    );
    window.sessionStorage.removeItem(LEARN_TUTORIAL_STORAGE_KEY);
    delete document.documentElement.dataset.learnTutorial;
  }, [currentUser?.id]);

  useEffect(() => {
    if (isFullScreenChat || showAiChatInterface) setChatRuntimeMounted(true);
  }, [isFullScreenChat, showAiChatInterface]);

  useEffect(() => {
    if (
      (aiChatOpenSwitchesEnabled && !manualChat) ||
      !chatAutoOpenReady ||
      hasAttemptedChatRestoreRef.current ||
      !currentUser?.id ||
      !pathname ||
      NO_CHAT_RESTORE_ROUTES.some((route) => pathname.startsWith(route))
    ) {
      return;
    }
    hasAttemptedChatRestoreRef.current = true;
    if (!manualChat && window.innerWidth < 768) return;
    const restoreOpen = manualChat ? readChatOpenForSession() : !keepAiChatClosed && !aiChatAutoOpenSuppressed && readChatOpenForSession();
    if (restoreOpen) {
      setChatRuntimeMounted(true);
      setShowAiChatInterface(true);
      setAiChatExplicitOpenAt(null);
    }
  }, [currentUser?.id, aiChatOpenSwitchesEnabled, manualChat, chatAutoOpenReady, keepAiChatClosed, aiChatAutoOpenSuppressed, pathname, setShowAiChatInterface, setAiChatExplicitOpenAt]);

  useEffect(() => {
    if (!hasAttemptedChatRestoreRef.current) return;
    writeChatOpenForSession(showAiChatInterface);
  }, [showAiChatInterface]);

  useEffect(() => {
    if (shouldMountChatRuntime || isFullScreenChat) return;
    const openChatFromFocusShortcut = (event: KeyboardEvent) => {
      if (!isControlQFocusShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setChatRuntimeMounted(true);
      openAIChatInterface();
    };
    document.addEventListener("keydown", openChatFromFocusShortcut, true);
    return () => {
      document.removeEventListener("keydown", openChatFromFocusShortcut, true);
    };
  }, [isFullScreenChat, openAIChatInterface, shouldMountChatRuntime]);

  const [announcements, setAnnouncements] = useState<IAnnouncement[]>([]);
  const [showAnnouncementBanner, setShowAnnouncementBanner] = useState<
    IAnnouncement | undefined
  >();

  const lastgClick = useRef<number | null>(null);
  const teamCycleSeq = useRef(0);
  const autoInterruptedIds = useRef<Set<number>>(new Set());

  const { data: allTeamsForCycle } = useGetAllTeamsMinimal(
    currentUser?.id ?? null,
    undefined,
    { enabled: secondaryStartupEnabled },
  );
  const lastUsedBoardsForCycle = useRecoilValue(lastUsedBoardsAtom);
  const setAgentChatTeamCycle = useSetRecoilState(agentChatTeamCycleAtom);
  useGetAllProjectsMinimal(["projectsAllMinimal"], undefined, {
    enabled: secondaryStartupEnabled,
  });
  useGetHyperAI(undefined, { enabled: secondaryStartupEnabled });
  useInboxRealtime(secondaryStartupEnabled ? (currentUser?.id ?? null) : null);
  const { data: announcementsTQ } = useGetAnnouncements(
    currentUser?.id,
    undefined,
    {
      enabled: secondaryStartupEnabled,
    },
  );

  const appShellRailOn = useRecoilValue(appShellRailAtom) && !mbl;
  useClickOutside(
    null,
    closeAnnouncements,
    "announcements-component-container",
  );
  useEffect(() => {
    closeAnnouncements();
  }, [pathname, closeAnnouncements]);

  useEffect(() => {
    resetShowCommands();
  }, [pathname, resetShowCommands]);

  const agentChatMobileFullscreenAtomOn = useRecoilValue(
    agentChatMobileFullscreenAtom,
  );
  const agentChatHidesMobileShell =
    agentChatMobileFullscreenAtomOn ||
    isAgentChatPath(pathname);
  const commentComposerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  let reserveFlaggedBoardChat = false;
  if (useFlag(HTPR_7406_DESKTOP_SERVER_BOARD_FLAG) && !aiChatOpenSwitchesEnabled) reserveFlaggedBoardChat = reserveBoardChat;
  const { sidebarWidthPx, showMobileShellPath, showMobileTabBar, showMobileBottomInset, showMobileBottomNav } = usePageLoadReservations({
    mbl,
    pathname,
    authenticatedUserId,
    currentUserId: currentUser?.id,
    showAiChatInterface,
    reserveBoardChat: reserveFlaggedBoardChat,
    aiChatSwitchReserve: aiChatOpenSwitchesEnabled ? aiChatSwitchReserve : undefined,
    aiChatAutoOpenSuppressed,
    commentComposerOpen,
    agentChatHidesMobileShell,
  });
  const enableMobilePullDownCommand =
    showMobileTabBar &&
    !commentComposerOpen &&
    shouldEnableMobilePullDownCommand(pathname);
  const mobileBottomInsetVisible =
    showMobileBottomInset && mobileBoardControlsReady;
  const mobileCreateTaskButtonVisible =
    mobileBottomInsetVisible &&
    !showAiChatInterface &&
    shouldShowMobileCreateTaskButton(pathname);
  const mobilePullCommandVisible =
    enableMobilePullDownCommand && mobileBoardControlsReady;

  const { goToProjectShortcut } = useProjectQuery();
  const queryClient = useQueryClient();
  useInboxEFirstPressQueue(queryClient);
  useInboxLegacyWarm(pathname, mbl);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  const { allowShowSettings, showTrialModal, setShowTrialModal } =
    useGlobalPathCheck(currentUser);

  const { showEmailVerificationModal, setShowEmailVerificationModal } =
    useEmailVerificationModal();

  const navigateFromGlobalGShortcut = useCallback(
    async (action: GlobalGShortcutAction) => {
      if (action === "Trash") {
        navigate("Trash", _currentProject?.id);
        return;
      }
      if (action !== "Board") {
        navigate(action);
        return;
      }

      const previousBoardId = Number(
        decodeURIComponent(
          document.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith("previousBoard="))
            ?.split("=")[1] ?? "",
        )
          .split("|&|")[0]
          ?.replace("project-", ""),
      );
      const boardId = await boardShortcutLookup(
        queryClient,
        currentUser?.id,
        [_currentProject?.id, previousBoardId],
        (): Promise<IProject[]> =>
          globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
      );
      if (boardId) {
        markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: boardId });
        goToProjectShortcut(boardId, true);
      } else {
        router.push("/project");
      }
    },
    [
      _currentProject?.id,
      boardShortcutLookup,
      currentUser?.id,
      goToProjectShortcut,
      navigate,
      queryClient,
      router,
    ],
  );
  const globalGShortcutNavigateRef = useRef(navigateFromGlobalGShortcut);
  globalGShortcutNavigateRef.current = navigateFromGlobalGShortcut;
  const globalGShortcutIgnoreRef = useRef(false);
  globalGShortcutIgnoreRef.current =
    showTrialModal ||
    showEmailVerificationModal ||
    !areGlobalShortcutsEnabled(pathname);

  useEffect(() => {
    const handleGlobalGShortcut = createGlobalGShortcutCapture({
      delayMs: globalConstants.gThenKeyDelay,
      shouldIgnore: () => {
        if (globalGShortcutIgnoreRef.current) return true;
        const activeElement = document.activeElement as HTMLElement | null;
        const tagName = activeElement?.tagName.toLowerCase();
        return (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          activeElement?.isContentEditable === true ||
          Boolean(activeElement?.closest(".ProseMirror, .chatwindow")) ||
          Boolean(activeElement?.closest("[role='dialog']")) ||
          Boolean(document.querySelector(".modal.show"))
        );
      },
      onShortcut: (action) => {
        lastgClick.current = null;
        globalGShortcutNavigateRef.current(action);
      },
    });
    document.addEventListener("keydown", handleGlobalGShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleGlobalGShortcut, true);
  }, []);
  useCommandCenterShortcut(
    authenticatedUserId,
    isApple,
    pathname,
    showTrialModal,
    showEmailVerificationModal,
    toggleShowCommands,
  );

  const handleKeyPress = async (e: KeyboardEvent) => {
    if (showTrialModal || showEmailVerificationModal) return;
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    if (isFavoriteBoardShortcut(e, isApple)) {
      e.preventDefault();
    }

    if (!areGlobalShortcutsEnabled(pathname)) return;
    if (favorites && !pathname?.startsWith("/project")) {
      if (isFavoriteBoardShortcut(e, isApple)) {
        e.preventDefault();
        const digit = parseInt(e.code.replace("Digit", ""));
        const index = favorites?.findIndex(
          (favorite) => favorite.index === digit,
        );
        if (index >= 0 && currentProjectIndex !== index) {
          setCurrentProjectIndex(index);
          markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: favorites[index].project.id });
          goToProjectShortcut(favorites[index].project.id, true);
        }
        return;
      }
    }

    const isInputFocused = ["input", "textarea"].includes(
      (document.activeElement as HTMLElement)?.tagName?.toLowerCase(),
    );
    if (isInputFocused && e.keyCode !== KeyCodes.ESCAPE) return;

    if (
      document.activeElement?.className ===
        "tiptap ProseMirror ProseMirror-focused" ||
      isInputFocused
    )
      return;

    if (
      e.keyCode === KeyCodes.ESCAPE &&
      !preventEscapeOnCommandModes.includes(showCommands.mode)
    )
      GlobalProvidersEscapeHandler();

    if (e.keyCode === KeyCodes.ARROW_DOWN || e.keyCode === KeyCodes.ARROW_UP) {
      e.preventDefault();
    }

    if (controller[e.keyCode]) {
      controller[e.keyCode].pressed = true;
    }

    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay);
    }

    if (e.keyCode === KeyCodes.T) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Timers");
      }
    }
    if (e.keyCode === KeyCodes.H) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Reminders");
      }
    }
    if (e.keyCode === KeyCodes.I) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Inbox");
      }
    }

    if (
      e.keyCode === KeyCodes.SEMICOLON &&
      !e.shiftKey &&
      !cmdControl &&
      !e.altKey
    ) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        e.preventDefault();
        lastgClick.current = null;
        navigate("Snippets");
      }
    }

    if (e.keyCode === KeyCodes.S) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Starred");
      }
    }
    if (e.keyCode === KeyCodes.P) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Pinned");
      }
    }

    if (e.keyCode === KeyCodes.E) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Task Archive");
      }
    }

    if (e.keyCode === KeyCodes.R) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Inbox Archive");
      }
    }

    if (e.shiftKey && e.keyCode === KeyCodes.THREE) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Trash", _currentProject?.id);
      }
    }

    if (e.keyCode === KeyCodes.A) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("All Tasks");
      }
    }

    if (
      e.keyCode === KeyCodes.M &&
      !cmdControl &&
      !e.shiftKey &&
      !e.altKey &&
      (document.activeElement as HTMLElement)?.tagName?.toLowerCase() !==
        "select"
    ) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("My Tasks");
      }
    }

    if (e.keyCode === KeyCodes.D) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Drafts");
      }
    }

    if (e.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        navigate("Scheduled");
      }
    }

    if (
      e.keyCode === KeyCodes.B &&
      !cmdControl &&
      !e.shiftKey &&
      (document.activeElement as HTMLElement)?.tagName?.toLowerCase() !==
        "select"
    ) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        lastgClick.current = null;
        e.preventDefault();
        const previousBoardId = Number(
          decodeURIComponent(
            document.cookie
              .split("; ")
              .find((cookie) => cookie.startsWith("previousBoard="))
              ?.split("=")[1] ?? "",
          )
            .split("|&|")[0]
            ?.replace("project-", ""),
        );
        const boardCandidates = [_currentProject?.id, previousBoardId];
        const fetchBoardList = (): Promise<IProject[]> =>
          globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal");
        const boardId = await boardShortcutLookup(
          queryClient,
          currentUser?.id,
          boardCandidates,
          fetchBoardList,
        );
        if (boardId) {
          markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: boardId });
          goToProjectShortcut(boardId, true);
        } else {
          router.push("/project");
        }
        return;
      }
    }

    if (
      e.keyCode === KeyCodes.B &&
      (pathname?.startsWith("/search") ||
        pathname?.startsWith("/archive") ||
        pathname?.startsWith("/pricing") ||
        pathname?.startsWith("/detail") ||
        pathname?.startsWith("/project") ||
        pathname?.startsWith("/trash") ||
        pathname?.startsWith("/starred") ||
        pathname?.startsWith("/drafts") ||
        pathname?.startsWith("/inbox") ||
        pathname?.startsWith("/calendar") ||
        pathname?.startsWith("/all-tasks") ||
        pathname?.startsWith("/time") ||
        pathname?.startsWith("/report") ||
        pathname?.startsWith("/page") ||
        pathname?.startsWith("/agents") ||
        pathname?.startsWith("/settings"))
    ) {
      if (cmdControl) {
        e.preventDefault();
        toggleLeftSidebar();
      }
    }

    if (
      e.altKey &&
      e.shiftKey &&
      !cmdControl &&
      (e.keyCode === KeyCodes.ARROW_DOWN || e.keyCode === KeyCodes.ARROW_UP) &&
      (pathname?.startsWith("/search") ||
        pathname?.startsWith("/archive") ||
        pathname?.startsWith("/pricing") ||
        pathname?.startsWith("/detail") ||
        pathname?.startsWith("/project") ||
        pathname?.startsWith("/trash") ||
        pathname?.startsWith("/starred") ||
        pathname?.startsWith("/drafts") ||
        pathname?.startsWith("/inbox") ||
        pathname?.startsWith("/calendar") ||
        pathname?.startsWith("/all-tasks") ||
        pathname?.startsWith("/time") ||
        pathname?.startsWith("/report") ||
        pathname?.startsWith("/page") ||
        pathname?.startsWith("/agents") ||
        pathname?.startsWith("/settings"))
    ) {
      const activeElement = document.activeElement as HTMLElement | null;
      const tagName = activeElement?.tagName.toLowerCase();
      const isTyping =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        activeElement?.isContentEditable === true;
      if (!isTyping) {
        e.preventDefault();
        const direction = e.keyCode === KeyCodes.ARROW_DOWN ? 1 : -1;
        if (pathname?.startsWith("/agents/chat")) {
          teamCycleSeq.current += 1;
          setAgentChatTeamCycle({ direction, seq: teamCycleSeq.current });
        } else {
          const teams = orderTeamsForSwitcher(
            allTeamsForCycle ?? [],
            lastUsedBoardsForCycle,
          );
          if (teams.length > 0) {
            const currentTeamId = _currentProject?.teamId ?? getLastBoardTeam();
            const currentIndex = teams.findIndex((t) => t.id === currentTeamId);
            const nextIndex =
              currentIndex === -1
                ? 0
                : (currentIndex + direction + teams.length) % teams.length;
            const nextTeam = teams[nextIndex];
            const nextBoard = nextTeam.projects?.[0];
            if (nextBoard) {
              setLastBoardTeam(nextTeam.id);
              markBoardSwitchIntent({
                surface: "keyboard_shortcut",
                projectId: nextBoard.id,
              });
              goToProjectShortcut(nextBoard.id, true);
            }
          }
        }
      }
    }

    if (isGlobalCreateTaskShortcut(e, pathname)) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        e.preventDefault();
        lastgClick.current = null;
        return navigate("Calendar");
      } else {
        e.preventDefault();
        toggleCreateTaskGlobally();
      }
    }

    if (e.keyCode === KeyCodes.BACKSLASH && !cmdControl && !e.shiftKey) {
      e.preventDefault();
      if (!currentUser) return;
      openSettings();
    }

    if (
      (e.keyCode === KeyCodes.FORWARD_SLASH ||
        ((e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.O) &&
          !showAiChatInterface)) &&
      !pathname?.startsWith("/calendar") &&
      !pathname?.startsWith("/login") &&
      e.shiftKey &&
      cmdControl
    ) {
      e.preventDefault();
      toggleAIChatInterface();
    }
    if (e.keyCode === KeyCodes.FORWARD_SLASH && e.shiftKey && !cmdControl) {
      e.preventDefault();
      toggleKeyboardShortcuts();
    }
    if (
      e.keyCode === KeyCodes.FORWARD_SLASH &&
      !cmdControl &&
      !e.shiftKey &&
      !window.location.pathname.includes("/search")
    ) {
      e.preventDefault();
      router.push(
        buildSearchUrl(
          "",
          null,
          false,
          boardContextFromPath(pathname, currentProject?.id)
        )
      );
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  };


  const markAllAsRead = async () => {
    if (announcements?.length > 0 && currentUser) {
      await axios.post("/api/users/announcements/getUserAnnouncements", {
        userId: currentUser.id,
        announcementIds: announcements.map((a) => a.announcementId),
      });
    }
  };

  const markAnnouncementRead = (announcementId: number) => {
    if (!currentUser) return;
    const readAt = new Date().toISOString();
    queryClient.setQueryData(
      [prefixUseGetAnnouncements, currentUser.id],
      (previous: IAnnouncement[] | undefined) =>
        Array.isArray(previous)
          ? previous.map((item) =>
              item.announcementId === announcementId
                ? { ...item, readAt }
                : item,
            )
          : previous,
    );
    void axios
      .post("/api/users/announcements/getUserAnnouncements", {
        userId: currentUser.id,
        announcementIds: [announcementId],
      })
      .catch((error) =>
        console.error("Failed to mark announcement read", error),
      );
  };

  const triggerAnnouncementInterruption = (announcementsFromTQ: unknown) => {
    const announcementList = Array.isArray(announcementsFromTQ)
      ? (announcementsFromTQ as IAnnouncement[])
      : [];
    setAnnouncements(announcementList);

    if (!pathname || NO_INTERRUPTION_ROUTES.some((r) => pathname.startsWith(r)))
      return;
    if (showAccouncementSlide || showAnnouncementBanner || showTrialModal)
      return;

    const next = announcementList.find((announcement) => {
      if (announcement.readAt) return false;
      const level = getExplicitLevel(announcement.announcement.body);
      if (level === "banner") return true;
      return (
        level === "takeover" &&
        (announcement.announcement.body.slides?.length ?? 0) > 0
      );
    });
    if (!next || autoInterruptedIds.current.has(next.announcementId)) return;
    autoInterruptedIds.current.add(next.announcementId);

    if (getExplicitLevel(next.announcement.body) === "takeover") {
      setShowAnnouncementSlide(next);
    } else {
      setShowAnnouncementBanner(next);
    }
  };

  useEffect(() => {
    triggerAnnouncementInterruption(announcementsTQ);
  }, [
    announcementsTQ,
    pathname,
    showTrialModal,
    showAccouncementSlide,
    showAnnouncementBanner,
  ]);

  useEffect(() => {
    if (showAccouncementSlide) setShowAnnouncementBanner(undefined);
  }, [showAccouncementSlide]);

  useEffect(() => {
    if (pathname?.startsWith("/login") && showAiChatInterface) {
      closeAIChatInterface();
    }
  }, [pathname, showAiChatInterface, closeAIChatInterface]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyPress);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    lastgClick,
    showCommands.mode,
    showSidebar,
    showBoardManager,
    showShortcuts,
    allowShowSettings,
    favorites,
    currentProjectIndex,
    pathname,
    showGlobalCreateHTCTask,
    handleKeyPress,
    handleKeyUp,
    showTrialModal,
  ]);


  return (
    <div className="scrollbar-none text-white-black">
      <Toaster
        containerClassName={mbl ? "toastContainerMobile" : ""}
        toastOptions={{
          duration: 3000,
          style: { background: "#222222", color: "white" },
        }}
        position={mbl ? "top-right" : "bottom-left"}
      />
      <SingleUndoToaster mobile={mbl} appShellRailOn={appShellRailOn} />
      <ShortcutArchiveNudge />

      {showGlobalCreateHTCTask.show && (
        <CreateTaskGlobally
          shouldShow={showGlobalCreateHTCTask.show}
          closeCallback={() => toggleCreateTaskGlobally()}
        />
      )}
      {showScrollSettings && (
        <ScrollSettings
          toggle={() => {
            setShowScrollSettings(false);
          }}
        />
      )}
      {showAccouncementSlide && (
        <AnnouncementSlideModal
          toggle={() => {
            markAnnouncementRead(showAccouncementSlide.announcementId);
            setShowAnnouncementSlide(undefined);
          }}
          announcementSlides={getAnnouncementSlides(
            showAccouncementSlide.announcement.body,
          )}
        />
      )}
      {showAnnouncementBanner && currentUser && (
        <AnnouncementBanner
          announcement={showAnnouncementBanner}
          userId={currentUser.id}
          onDismiss={() => setShowAnnouncementBanner(undefined)}
        />
      )}
      {shouldShowMobileOverlay && (
        <MobileBlockingOverlay
          userEmail={userEmail}
          onDismiss={hideMobileOverlay}
        />
      )}

      {showEmailVerificationModal && currentUser && (
        <EmailVerificationModal
          currentUser={currentUser}
          onVerified={() => {
            router.refresh();
            setShowEmailVerificationModal(false);
          }}
        />
      )}

      {showBoardManager && (
        <LeftSidebar toggleLeftSidebar={toggleLeftSidebar} />
      )}
      {showSidebar && <RightSidebar _appHandler={toggleRightSidebar} />}
      {showMcpTokenModal && currentUser && (
        <McpTokenModal
          currentUser={currentUser}
          closeHandler={() => setShowMcpTokenModal(false)}
        />
      )}
      {allowShowSettings && !mbl && (
        <div id="gear" tabIndex={-1} className="bottom-right">
          <BottomSettingsQuickTips announcements={announcements} />
        </div>
      )}
      {appShellRailOn &&
        !pathname?.startsWith("/project") &&
        !pathname?.startsWith("/inbox") &&
        !pathname?.startsWith("/calendar") && <GuestAuthLinks floating />}
      {!mbl && <NotificationPromoteBanner />}
      {!currentUser && <CookieConsentBanner />}
      {showShortcuts && <KeyboardShortcuts />}
      {showGuestLogin === true && (
        <GuestLoginModal onClose={() => setShowGuestLogin(false)} />
      )}
      {showAccountSwitcher === true && (
        <SwitchAccountModal
          closeHandler={() => setShowAccountSwitcher(false)}
        />
      )}

      {agentChatMobileFullscreenAtomOn ||
      isAgentChatPath(pathname) ? null : (
        showMobileShellPath && currentUser && (
        <>
          {!routeOwnsMobileChrome && <MobileTopBar
            currentUser={currentUser}
            boardUsable={mobileBoardControlsReady}
          />}
          {!routeOwnsMobileChrome && showMobileBottomNav && mobileBoardControlsReady && (
            <MobileTabBar currentUserId={currentUser.id} />
          )}
          {mobileCreateTaskButtonVisible && <MobileCreateTaskButton />}
          {mobilePullCommandVisible && (
            <MobilePullDownCommand />
          )}
        </>
        )
      )}

      {showAnnouncements && (
        <Announcements
          allPosts={announcements}
          placement={appShellRailOn ? "left" : "right"}
          toggleSidebar={closeAnnouncements}
        />
      )}

      {authenticatedUserId !== null &&
        showCommands.show &&
        shouldRenderGlobalCommandMenu(pathname, myTasksSingleCommandCenter) && <HypertasksCommands />}

      {composeTaskWriterEnabled && authenticatedUserId !== null && showCommands.show && pathname === "/new" && <HypertasksCommands />}

      <BoardStartupContext.Provider
        value={{
          releaseSecondaryStartup,
          markBoardUsable,
          secondaryStartupEnabled,
        }}
      >
        <ChatRuntimeHost
          mounted={shouldMountChatRuntime}
          holdChildren={isFullScreenChat || shouldMountAgentChatRuntime}
          loading={<FullScreenChatLoading />}
          Runtime={ChatRuntime}
        >
          {isFullScreenChat ? (
            children
          ) : (
            <AIChatClosedLayout
              mobileTopBarVisible={showMobileTabBar}
              mobileTabBarVisible={mobileBottomInsetVisible}
              mobilePullCommandEnabled={mobilePullCommandVisible}
              onOpenAIChat={openAIChatInterface}
              chatOpen={showAiChatInterface}
              sidebarWidthPx={sidebarWidthPx}
              panels={
                shouldMountChatRuntime ? (
                  <Suspense fallback={null}>
                    <AIChatPanels />
                  </Suspense>
                ) : undefined
              }
            >
              <CachedTaskDetailNavigation accountId={authenticatedUserId}>
                {children}
              </CachedTaskDetailNavigation>
            </AIChatClosedLayout>
          )}
        </ChatRuntimeHost>
      </BoardStartupContext.Provider>
      {ReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </div>
  );
}
