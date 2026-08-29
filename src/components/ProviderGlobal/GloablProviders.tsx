/* eslint-disable react-hooks/exhaustive-deps */
"use client";
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
import { useMobileToastAutoDismiss } from "@/components/undoToast/useMobileToastAutoDismiss";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { KeyCodes, KeyValues } from "@/lib/constants/keyboard-handler";
import { useQueryClient } from "@tanstack/react-query";
import { IProject } from "@/models/model";

// import { getAllProjectsMinimal, getAllTeamsForLSidebar } from "@/utils/api/Homepage";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import {
  showBoardManagerAtom,
  showShortcutsAtom,
  showGuestLoginAtom,
  showCommandsAtom,
  showCreateTaskModalAtom,
  showScrollSettingModalAtom,
  showMcpTokenModalAtom,
  announcementSlideAtom,
  mobileCommentComposerOpenAtom,
  showAccountSwitcherAtom,
  appShellRailAtom,
  currentUserAtom,
} from "@/store";

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
const MobilePullDownCommand = dynamic(
  () => import("../Global/MobilePullDownCommand"),
  { ssr: false },
);
const MobileTopBar = dynamic(() => import("../Global/MobileTopBar"), {
  ssr: false,
});
const BottomSettingsQuickTips = dynamic(
  () => import("../Global/BottomSettings_QuickTips"),
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
import { isCommandCenterShortcut } from "@/lib/constants/commandCenterShortcut";
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
import { useEmojiFrequencyHydration } from "@/hooks/General/useEmojiFrequencyHydration";

import AIChatClosedLayout from "../AI_CHAT/AI_Chat_Closed_Layout";
import FullScreenChatLoading from "../AI_CHAT/FullScreenChatLoading";
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

// React.lazy is intentional here. next/dynamic emits route preload hints for
// rendered boundaries, which fetched these chunks while the chat was closed.
// The chat runtime should not be requested until an open intent or /chat route.
const AIChatLayout = lazy(() => import("../AI_CHAT/AI_Chat_Layout"));
const ChatProvider = lazy(() =>
  import("@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context").then(
    (module) => ({ default: module.ChatProvider }),
  ),
);
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
  shouldShowMobileTabBar,
  shouldShowMobileDock,
  shouldShowMobilePrimaryDock,
  shouldEnableMobilePullDownCommand,
} from "../Global/mobileShellVisibility";
import { BoardStartupContext } from "@/lib/contexts/boardStartupContext";
import {
  MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS,
  shouldShowMobileBoardControls,
} from "@/lib/boardStartup/mobileControls";
import { shouldEnableSecondaryStartup } from "@/lib/boardStartup/secondaryRequests";
// const CreateTaskGlobally = dynamic(()=>import("@/components/Modals/CreateTaskGloballyModal"),{ssr:false})

const preventEscapeOnCommandModes: CommandMode[] = [
  CommandMode.AICustomInstruction,
];

// Routes where an announcement must never pop: sign-up/-in, onboarding and the
// public/marketing pages. Everywhere else in the app is fair game, so a user who
// lives in the Inbox still sees the announcement.
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

// Session chat restoration belongs to signed-in workspaces only. Keep the
// intent unconsumed on auth/onboarding/system routes so a later navigation to a
// board can still restore it without loading the chat runtime over those pages.
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

export default function GlobalProvider({ children }: { children: ReactNode }) {
  // ------------------------ context & hooks
  useMobileToastAutoDismiss(); // PERT-92: resume stuck dismiss timers after a tap
  const isApple = useDeviceContext();
  const mbl = useContext(MobileViewContext);
  const pathname = usePathname();
  useAppShellSurfaceShortcuts();
  const startupUser = useRecoilValue(currentUserAtom);
  const projectRoute = pathname?.startsWith("/project") ?? false;
  const startupAccountKey = startupUser?.id ?? "anonymous";
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

  // ------------------------ global state / recoil
  const {
    resetShowCommands,
    toggleShowCommands,
    toggleCreateTaskGlobally,
    resetCreateTaskGlobally,
    GlobalProvidersEscapeHandler,
  } = useHypertasksRecoilStates();

  // ------------------------ centralized UI state management
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
  // Settings is the full-screen /settings page now; the old right sidebar is
  // retired (nothing opens it — the render below is left dormant).
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
  // The Ctrl+K palette can also open the account switcher (commands.tsx);
  // yield to it so the modal never double-mounts.
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
  const isTaskDetailPage = pathname?.startsWith("/detail") ?? false;
  const [chatRuntimeMounted, setChatRuntimeMounted] = useState(
    isFullScreenChat || showAiChatInterface,
  );
  const hasAttemptedChatRestoreRef = useRef(false);
  const shouldMountChatRuntime =
    chatRuntimeMounted ||
    isFullScreenChat ||
    isTaskDetailPage ||
    showAiChatInterface;
  // https://app.hypertask.ai/detail/project-15/5424: clear both legacy and
  // user-scoped tutorial state without ever loading the disabled runtime. This
  // prevents a returning tab from reviving the overlay after the entry points
  // and routes have been closed.
  useEffect(() => {
    if (!currentUser?.id) return;
    window.sessionStorage.removeItem(
      getLearnTutorialStorageKey(currentUser.id),
    );
    window.sessionStorage.removeItem(LEARN_TUTORIAL_STORAGE_KEY);
    delete document.documentElement.dataset.learnTutorial;
  }, [currentUser?.id]);

  // Mount on the first real chat intent, then latch for the rest of the page
  // session so closing the panel does not destroy an unsent draft or stream.
  useEffect(() => {
    if (isFullScreenChat || showAiChatInterface) setChatRuntimeMounted(true);
  }, [isFullScreenChat, showAiChatInterface]);

  // Restore the desktop reload state before ChatProvider exists. This used to
  // live inside the expensive provider and therefore forced it to mount just
  // to discover that chat was closed.
  useEffect(() => {
    if (
      hasAttemptedChatRestoreRef.current ||
      !currentUser?.id ||
      !pathname ||
      NO_CHAT_RESTORE_ROUTES.some((route) => pathname.startsWith(route))
    ) {
      return;
    }
    hasAttemptedChatRestoreRef.current = true;
    if (window.innerWidth < 768) return;
    if (readChatOpenForSession()) {
      setChatRuntimeMounted(true);
      openAIChatInterface();
    }
  }, [currentUser?.id, openAIChatInterface, pathname]);

  useEffect(() => {
    if (!hasAttemptedChatRestoreRef.current) return;
    writeChatOpenForSession(showAiChatInterface);
  }, [showAiChatInterface]);

  // Control+Q must still open the chat before its provider/listeners exist.
  // Once mounted, ChatProvider owns the established two-way focus behavior.
  useEffect(() => {
    if (shouldMountChatRuntime || isFullScreenChat) return;
    const openChatFromFocusShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "q" ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      ) {
        return;
      }
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

  // ------------------------ app state
  const [announcements, setAnnouncements] = useState<IAnnouncement[]>([]);
  const [showAnnouncementBanner, setShowAnnouncementBanner] = useState<
    IAnnouncement | undefined
  >();

  // ------------------------ refs
  const lastgClick = useRef<number | null>(null);
  const autoInterruptedIds = useRef<Set<number>>(new Set());

  // ------------------------ data fetching
  useGetAllTeamsMinimal(currentUser?.id ?? null, undefined, {
    enabled: secondaryStartupEnabled,
  });
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

  // "Latest updates" is hosted here, once, so every entry point (the rail
  // rocket, the mobile top-bar rocket, the floating gear stack and the Ctrl+K
  // "What's new" command) opens the same panel on every route. The rail sits at
  // x=48px, so the panel slides in from the left next to it; everywhere else
  // (mobile, rail off) it comes from the right.
  // No refetch on close: the panel marks the cache read when it opens, and a
  // GET that overtakes the in-flight mark-read POST would restore readAt: null
  // and re-light the rocket (HTPR-4652).
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !mbl;
  useClickOutside(
    null,
    closeAnnouncements,
    "announcements-component-container",
  );
  // The host never unmounts, so without this the panel would follow the user
  // across every route change. Route change = dismiss, as it did when each
  // surface owned its own copy.
  useEffect(() => {
    closeAnnouncements();
  }, [pathname, closeAnnouncements]);

  // Command-palette modals live in a global atom, so one left open on a task
  // detail reopens itself on the next route (the share sheet reappearing on the
  // calendar). Leaving the page dismisses whatever was open.
  useEffect(() => {
    resetShowCommands();
  }, [pathname, resetShowCommands]);

  // The mobile shell (top bar + pull-to-command) is present on every root view
  // including task detail. The bottom dock is the exception: hidden on detail
  // (shouldShowMobileDock) so the composer owns the bottom edge.
  const showMobileTabBar =
    mbl && Boolean(currentUser?.id) && shouldShowMobileTabBar(pathname);
  // Entering the mobile comment composer hides the bottom nav so the sheet
  // sits directly on the keyboard (the top bar stays for the back button).
  const commentComposerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  const showMobileBottomInset =
    mbl &&
    Boolean(currentUser?.id) &&
    shouldShowMobileDock(pathname) &&
    !commentComposerOpen;
  const showMobileBottomNav =
    showMobileBottomInset && shouldShowMobilePrimaryDock(pathname);
  // Pull-to-command follows the shell, not the dock, so it stays live on detail
  // even though the dock is gone (this also keeps pull-to-refresh disabled).
  const enableMobilePullDownCommand =
    showMobileTabBar &&
    !commentComposerOpen &&
    shouldEnableMobilePullDownCommand(pathname);
  const mobileBottomInsetVisible =
    showMobileBottomInset && mobileBoardControlsReady;
  const mobilePullCommandVisible =
    enableMobilePullDownCommand && mobileBoardControlsReady;

  // ------------------------ shortcuts / routing helpers
  const { goToProjectShortcut } = useProjectQuery();
  const queryClient = useQueryClient();
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };

  // ------------------------ trial settings
  const { allowShowSettings, showTrialModal, setShowTrialModal } =
    useGlobalPathCheck(currentUser);

  // ------------------------ email verification check
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
      const availableBoards = currentUser?.id
        ? await queryClient
            .fetchQuery<IProject[]>({
              queryKey: ["projectsAllMinimal", currentUser.id],
              queryFn: () =>
                globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
              staleTime: 60_000,
            })
            .catch(() => [])
        : [];
      const boardId = [_currentProject?.id, previousBoardId].find(
        (candidate) =>
          Number.isInteger(candidate) &&
          availableBoards.some((project) => project.id === candidate),
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
        // The legacy bubble-phase handler still tracks the first `g` for
        // unrelated single-key behavior. Consume that pending state before
        // capture-phase navigation so a trailing key cannot navigate twice.
        lastgClick.current = null;
        globalGShortcutNavigateRef.current(action);
      },
    });
    document.addEventListener("keydown", handleGlobalGShortcut, true);
    return () =>
      document.removeEventListener("keydown", handleGlobalGShortcut, true);
  }, []);
  const handleKeyPress = async (e: KeyboardEvent) => {
    // console.log("🚀 ~ handleKeyPress ~ e GLOBAL PROVIDER:", e.keyCode)
    if (showTrialModal || showEmailVerificationModal) return;
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    // Reserve the platform's documented favorite-board modifier.
    if (isFavoriteBoardShortcut(e, isApple)) {
      e.preventDefault();
    }

    if (!areGlobalShortcutsEnabled(pathname)) return;
    // switch between favorite boards. Checked before the input/editor guards below so it
    // stays global: it has to work from search, AI chat, or any focused input.
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

    // The Command Center is a workspace-level shortcut. Keep it available on
    // task detail, agent pages, and Settings, including from focused inputs.
    if (isCommandCenterShortcut(e, isApple, pathname)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleShowCommands();
      return;
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

    // [g] press
    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, globalConstants.gThenKeyDelay);
    }

    // Check if both [g] and [t] for running timers
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
    // Check if both [g] and [h] for reminders
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
    // Check if both [g] and [i] for inbox
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

    // Check if both [g] and [;] for snippets
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

    // Check if both [g] and [s] for starred page
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
    // Check if both [g] and [p] for pinned page
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

    // Check if both [g] and [e] for task Archive
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

    // Check if both [g] and [r] for inbox archives
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

    // Check if both [g] and [shift] and [3] for trash ('3' is 51)
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

    // Check if both [g] and [a] to go to Inbox All
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

    // Check if both [g] and [m] to go to My Tasks
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

    // [g] then [b] for the board. Time tracking took [g][t], which used to be
    // the board chord, so the board needs its own again (HTPR-4714).
    // A focused <select> swallows letters as native typeahead, and the guard
    // above only covers input/textarea, so the report page's dropdowns would
    // navigate away mid-selection.
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
        // Only boards still in the user's list: a deleted board or revoked
        // membership would otherwise land on Unauthorized.
        // The global list can still belong to the previous account while the
        // startup gate is closed after an account switch. Keep the
        // intent-driven authorization list account-scoped so this shortcut can
        // never navigate with another account's cached boards.
        const availableBoards = currentUser?.id
          ? await queryClient
              .fetchQuery<IProject[]>({
                queryKey: ["projectsAllMinimal", currentUser.id],
                queryFn: () =>
                  globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
                staleTime: 60_000,
              })
              .catch(() => [])
          : [];
        const boardId = [_currentProject?.id, previousBoardId].find(
          (candidate) =>
            Number.isInteger(candidate) &&
            availableBoards.some((project) => project.id === candidate),
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

    // [b]
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
        // Every route that shows the app-shell rail advertises Ctrl+B on the
        // board-switcher tooltip, so the shortcut must fire there too (HTPR-4835).
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

    // =============== [c] for creating task any page except kanban or login page, run this.
    if (isGlobalCreateTaskShortcut(e, pathname)) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < globalConstants.gThenKeyDelay
      ) {
        e.preventDefault();
        lastgClick.current = null;
        return navigate("Calendar");
      } else if (!pathname?.startsWith("/my-tasks")) {
        // My Tasks is read-only, so [c] stays unclaimed there rather than
        // being swallowed by a preventDefault that opens nothing.
        e.preventDefault();
        toggleCreateTaskGlobally();
      }
      // // cmd/ctrl [j] for creating task
      // else if (e.keyCode === KeyCodes.J && document?.activeElement?.tagName !== "INPUT" && cmdControl && !(e.shiftKey)) {
      //   e.preventDefault();
      //   toggleCreateTaskGlobally(undefined,{defaultEditMode:"Description-ai", defaultFocus:"Description"})
      // }
    }

    // handle backslash "\" — opens the full-screen Settings page
    if (e.keyCode === KeyCodes.BACKSLASH && !cmdControl && !e.shiftKey) {
      e.preventDefault();
      if (!currentUser) return;
      openSettings();
    }

    // [ctrl][shift][?]
    // We need to edit this to update right
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
    // [shift][?]
    if (e.keyCode === KeyCodes.FORWARD_SLASH && e.shiftKey && !cmdControl) {
      e.preventDefault();
      toggleKeyboardShortcuts();
    }
    // "/" for search (ignore if already on search)
    if (
      e.keyCode === KeyCodes.FORWARD_SLASH &&
      !cmdControl &&
      !e.shiftKey &&
      !window.location.pathname.includes("/search")
    ) {
      e.preventDefault();
      router.push("/search?searchTerm=");
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  };

  // const trialModalCallback = () => {
  //   setShowTrialModal(false);
  // };

  const markAllAsRead = async () => {
    if (announcements?.length > 0 && currentUser) {
      await axios.post("/api/users/announcements/getUserAnnouncements", {
        userId: currentUser.id,
        announcementIds: announcements.map((a) => a.announcementId),
      });
    }
  };

  // Closing ONE announcement must not clear the unread state of the others: the
  // slides modal can now open on its own, not only from the (mark-all) sidebar.
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

    // Pick the newest unread one that actually interrupts. Selecting the newest
    // unread of ANY level would let a later note bury an unseen banner forever.
    // Only an EXPLICITLY published level may interrupt: everything already in the
    // database predates the ladder and stays sidebar-only, preserving the
    // deliberate "no auto-popup" behaviour it shipped with.
    const next = announcementList.find((announcement) => {
      if (announcement.readAt) return false;
      const level = getExplicitLevel(announcement.announcement.body);
      if (level === "banner") return true;
      return (
        level === "takeover" &&
        (announcement.announcement.body.slides?.length ?? 0) > 0
      );
    });
    // A set, not a high-water mark: an older unread banner must still get its turn
    // after a newer one is dismissed.
    if (!next || autoInterruptedIds.current.has(next.announcementId)) return;
    autoInterruptedIds.current.add(next.announcementId);

    if (getExplicitLevel(next.announcement.body) === "takeover") {
      setShowAnnouncementSlide(next);
    } else {
      setShowAnnouncementBanner(next);
    }
  };

  // ------- on announcements update
  useEffect(() => {
    triggerAnnouncementInterruption(announcementsTQ);
    // showAccouncementSlide/showAnnouncementBanner are deps so that an interruption
    // arriving while another one is open is retried once that one closes.
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

  // Close AI Chat when on login page (e.g. persisted state, session expired)
  useEffect(() => {
    if (pathname?.startsWith("/login") && showAiChatInterface) {
      closeAIChatInterface();
    }
  }, [pathname, showAiChatInterface, closeAIChatInterface]);

  useEffect(() => {
    // Add event listeners when the component mounts
    document.addEventListener("keydown", handleKeyPress);
    document.addEventListener("keyup", handleKeyUp);

    // Remove event listeners when the component unmounts
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

  // ================= set current project's index when url changes

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
      {/* Guest CTAs on every non-board surface. The board, inbox and calendar
          mount their own copy inside their header rows; everywhere else has
          no header row to join, so this floats top-right instead of adding a
          bar. */}
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

      {showMobileTabBar && (
        <>
          <MobileTopBar
            currentUser={currentUser}
            boardUsable={mobileBoardControlsReady}
          />
          {showMobileBottomNav && mobileBoardControlsReady && (
            <MobileTabBar currentUserId={currentUser.id} />
          )}
          {mobilePullCommandVisible && (
            <MobilePullDownCommand />
          )}
        </>
      )}

      {showAnnouncements && (
        <Announcements
          allPosts={announcements}
          placement={appShellRailOn ? "left" : "right"}
          toggleSidebar={closeAnnouncements}
        />
      )}

      <BoardStartupContext.Provider
        value={{
          releaseSecondaryStartup,
          markBoardUsable,
          secondaryStartupEnabled,
        }}
      >
        {shouldMountChatRuntime ? (
          <Suspense
            fallback={
              isFullScreenChat || isTaskDetailPage ? (
                <FullScreenChatLoading />
              ) : (
                <AIChatClosedLayout
                  mobileTopBarVisible={showMobileTabBar}
                  mobileTabBarVisible={mobileBottomInsetVisible}
                  mobilePullCommandEnabled={mobilePullCommandVisible}
                  onOpenAIChat={openAIChatInterface}
                >
                  {children}
                </AIChatClosedLayout>
              )
            }
          >
            <ChatProvider>
              {isFullScreenChat ? (
                children
              ) : (
                <AIChatLayout
                  mobileTopBarVisible={showMobileTabBar}
                  mobileTabBarVisible={mobileBottomInsetVisible}
                  mobilePullCommandEnabled={mobilePullCommandVisible}
                >
                  {children}
                </AIChatLayout>
              )}
            </ChatProvider>
          </Suspense>
        ) : (
          <AIChatClosedLayout
            mobileTopBarVisible={showMobileTabBar}
            mobileTabBarVisible={mobileBottomInsetVisible}
            mobilePullCommandEnabled={mobilePullCommandVisible}
            onOpenAIChat={openAIChatInterface}
          >
            {children}
          </AIChatClosedLayout>
        )}
      </BoardStartupContext.Provider>
      {ReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </div>
  );
}
