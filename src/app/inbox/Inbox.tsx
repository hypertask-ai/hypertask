/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client";
import {
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Search, Settings2, X } from "lucide-react";
import {
  INotification,
  ISavedContent,
  ITask,
  IUser,
  QueryParams,
  TRemoveFromInboxMode,
} from "@/models/model";
import Goback from "@/assets/gobackicon.svg";
// import InboxSplit from '@/components/notifications/inboxSplit';
const InboxSplit = dynamic(
  () => import("@/components/notifications/inboxSplit"),
  { ssr: false },
);

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  inboxDataQueryKey,
  useGetNotifications,
} from "@/hooks/Inbox/useGetNotifications";
import dynamic from "next/dynamic";
import { useRecoilState } from "@/lib/state";
import {
  showCommandsAtom,
  showShortcutsAtom,
  globalNotificationFocusAtom,
  appShellRailAtom,
} from "@/store";
import Tooltip from "@/components/Common/Tooltip";
import { useUndoContext } from "@/hooks/General/useUndo";
// Keep the command center in the page bundle: a pull-down must mount and focus
// its input during the committing touchend, before mobile user activation ends.
import HypertasksCommands from "@/components/commands";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import toast from "react-hot-toast";
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { type InboxTabMeta } from "@/utils/helperFunctions/helperFunctions";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useStarAndPin } from "@/hooks/Task Detail/useStarAndPin";
import {
  BulkSelectionProvider,
  useBulkSelectionContext,
} from "@/lib/contexts/Inbox/BulkSelectionContext";
import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import RemindMeInbox from "@/components/notifications/inboxSplit/RemindMeInbox";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useInboxZeroStyling } from "@/hooks/Inbox/useInboxZeroStyling";
import InboxZeroState from "@/components/Common/InboxZeroState";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";

import { useWarmProjectsAllQuery } from "@/hooks/Homepage/useGetBoards";
import SplitTitle from "@/components/notifications/inboxSplit/SplitTitle";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import InboxNotifyNudge from "@/components/notifications/InboxNotifyNudge";
import ManageSplitsModal from "@/components/notifications/ManageSplitsModal";
import GuestAuthLinks from "@/components/PageComponents/Kanban/HeaderComponents/GuestAuthLinks";
import {
  getLearnTutorialStorageKey,
  LEARN_TUTORIAL_STATE_UPDATED_EVENT,
  parseLearnTutorialState,
} from "@/lib/tutorial/learnTutorialState";
import {
  restoreInboxAfterUndo,
  updateInboxOptimistically,
} from "@/lib/inboxSync/optimistic";
import { canWarmPreviousBoardFromInbox } from "@/lib/inboxSync/warmPreviousBoard";
import MobileInboxSplitDock from "@/components/notifications/MobileInboxSplitDock";
import { shouldPreserveNativeInboxTab } from "@/lib/inboxKeyboardNavigation";
import { getInitialInboxSplitIndex } from "@/lib/inboxSplitSettings";
import { topInboxClusters } from "@/lib/inboxClusters";
import type { IAllCommands } from "@/models/model";

// Stable identity: a fresh [] would rebuild the whole Ctrl+K registry each render.
const NO_NOTIFICATIONS: INotification[] = [];

const Inbox = ({
  currentUser,
  queryParams,
  homepageRouter,
  originProject,
}: {
  currentUser: IUser;
  queryParams: QueryParams;
  homepageRouter: string;
  originProject: string;
}) => {
  const queryClient = useQueryClient();
  const isMbl = useContext(MobileViewContext);
  const [appShellRail] = useRecoilState(appShellRailAtom);
  const appShellRailOn = appShellRail && !isMbl;
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom,
  );
  const { undoData, undoAction } = useUndoContext();
  const [trigger, setTrigger] = useState<"ShowAll" | undefined>(
    queryParams?.showAll === "true" ? "ShowAll" : undefined,
  );
  const lastgClick = useRef<number | null>(null);
  const preselectedSplitProcessed = useRef<boolean>(false);
  const initialResetToFirstDone = useRef<boolean>(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedProject = queryParams?.projectId;
  const preselectedSplit = queryParams?.split;
  const notificationsQuery = useGetNotifications(currentUser.id);
  useWarmProjectsAllQuery({
    user: currentUser,
    projectId: originProject,
    enabled: canWarmPreviousBoardFromInbox(notificationsQuery.data),
  });
  const { data: _notificationsTQ } = notificationsQuery;
  const [showShortucts, _] = useRecoilState(showShortcutsAtom);
  const { toggleShowCommands, toggleCreateTaskGlobally } =
    useHypertasksRecoilStates();
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const [__notifications, _setNotifications] = useState<INotification[][]>();
  const [showInboxSearch, setShowInboxSearch] = useState(false);
  const [showManageSplits, setShowManageSplits] = useState(false);
  const [inboxSearch, setInboxSearch] = useState("");
  const [tutorialInboxNotificationIds, setTutorialInboxNotificationIds] =
    useState<Set<number> | null>(
      queryParams?.tutorial === "1" ? new Set() : null,
    );
  useEffect(() => {
    if (queryParams?.tutorial !== "1") {
      setTutorialInboxNotificationIds(null);
      return;
    }
    const readTutorialTargets = () => {
      const state = parseLearnTutorialState(
        window.sessionStorage.getItem(
          getLearnTutorialStorageKey(currentUser.id),
        ),
      );
      setTutorialInboxNotificationIds(
        new Set(
          state?.tutorialInboxTargets.map(
            ({ notificationId }) => notificationId,
          ) ?? [],
        ),
      );
    };
    readTutorialTargets();
    window.addEventListener(
      LEARN_TUTORIAL_STATE_UPDATED_EVENT,
      readTutorialTargets,
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_STATE_UPDATED_EVENT,
        readTutorialTargets,
      );
  }, [currentUser.id, queryParams?.tutorial]);
  const visibleNotifications = useMemo(() => {
    const keyword = inboxSearch.trim().toLowerCase();
    if (!__notifications) return __notifications;

    const tutorialFiltered = tutorialInboxNotificationIds
      ? __notifications.map((notifications) =>
          notifications.filter((notification) =>
            tutorialInboxNotificationIds.has(Number(notification.id)),
          ),
        )
      : __notifications;
    if (!keyword) return tutorialFiltered;

    return tutorialFiltered.map((notifications) =>
      notifications.filter(
        (notification) =>
          notification.task?.title?.toLowerCase().includes(keyword) ||
          notification.task?.ticketNumber?.toLowerCase().includes(keyword),
      ),
    );
  }, [__notifications, inboxSearch, tutorialInboxNotificationIds]);
  const [_notifications, setNotifications] = useState<INotification[]>();
  const [_selectedInbox, setSelectedInbox] = useState<INotification | null>();
  const [initialIndexReset, setInitialIndexReset] = useState<number>(
    globalFocus.currIdx ?? 0,
  );
  const classNamesToReturnFrom = [
    "modal-open",
    "ProseMirror ProseMirror-focused",
    undefined,
  ];
  const { archiveNotificationGetter, bulkArchiveNotifications } =
    useGlobalFocusHandler();
  const { starTask } = useStarAndPin();
  const { navigate } = useHypertasksNavigate();
  const isApple = useDeviceContext();

  // =============================== KEY EVENT HANDLERS
  const handleKeyDown = async (e: KeyboardEvent) => {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    const shouldPreventEscape = document.querySelector(".bulk-active");
    const modalOpenOrCarouselExists =
      document.querySelector(".modal") ||
      document.getElementById("carousel-container");
    const isAIChatTiptapFocused = document
      .getElementById("ai-chat-tiptap-editor")
      ?.contains(document.activeElement);

    const searchInputFocused =
      document.activeElement?.id === "search-inbox-filter-input";

    // Keys inside the reduced-search input must not fall through to the
    // shortcuts below: Escape closes the search (instead of the "Escape
    // leaves the inbox" branch), Ctrl+F keeps focus where it is.
    if (searchInputFocused) {
      if (e.keyCode === KeyCodes.ESCAPE) {
        (document.activeElement as HTMLElement).blur();
        setInboxSearch("");
        setShowInboxSearch(false);
      }
      if (e.keyCode === 70 && cmdControl) e.preventDefault();
      return;
    }

    // Once focus enters a draft row, leave Tab to the browser so keyboard users
    // can move between its controls. A visible draft must not disable split cycling.
    if (
      e.keyCode === KeyCodes.TAB &&
      shouldPreserveNativeInboxTab(document.activeElement)
    ) {
      return;
    }

    // Mobile exposes the split dock as real tabs. Preserve native Tab and
    // Shift+Tab traversal there; Arrow/Home/End switch splits inside the dock.
    if (isMbl && e.keyCode === KeyCodes.TAB) return;

    if (
      showCommands.show ||
      modalOpenOrCarouselExists ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === "modalButtons" ||
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === "htc" ||
      classNamesToReturnFrom.includes(document?.activeElement?.className) ||
      document.activeElement?.id === "boardManager" ||
      isAIChatTiptapFocused
    )
      return;

    // After the guards so it never steals focus from the palette, modals or
    // another input.
    if (!isMbl && e.keyCode === 70 && cmdControl) {
      e.preventDefault();
      setShowInboxSearch(true);
      setTimeout(() => {
        document.getElementById("search-inbox-filter-input")?.focus();
      }, 0);
      return;
    }

    if (e.keyCode === KeyCodes.ESCAPE && !shouldPreventEscape) {
      router.back();
      queryClient.refetchQueries({
        queryKey: inboxConfig.navigation.queryKeys.inbox,
      });
    }

    // [Z] FOR UNDO
    if (e.keyCode === KeyCodes.Z && undoData.length > 0) {
      const firstUndoData = undoData[undoData.length - 1];
      undoHandler(firstUndoData, firstUndoData.id);
    }

    // press k
    if (e.keyCode === KeyCodes.K && cmdControl) {
      e.preventDefault();
      toggleShowCommands();
    }

    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
    }

    // ========== [g] then  [i]
    if (e.keyCode === KeyCodes.I) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigateTabs(inboxConfig.navigation.defaultSplitIndex);
      }
    }

    //Going to calender view
    if (e.keyCode === KeyCodes.C) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Calendar");
        return;
      }
    }

    if (e.keyCode === KeyCodes.D) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Drafts");
        return;
      }
    }

    if (e.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.scroll.debounceGKeyMs
      ) {
        lastgClick.current = null;
        navigate("Scheduled");
        return;
      }
    }

    if (e.keyCode === KeyCodes.C && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      //we need to basically check if the AI Chat tiptap is focused or not
      e.preventDefault();
      toggleCreateTask();
    }

    if (e.keyCode === KeyCodes.TAB) {
      e.preventDefault();

      let newValue;
      if (e.shiftKey) {
        // Navigate to the previous tab
        newValue =
          globalFocus.currSplit !== 0
            ? globalFocus.currSplit - 1
            : _notificationsTQ?.structuredData?.data.length - 1;
      } else {
        // Navigate to the next tab
        newValue =
          globalFocus.currSplit !==
          _notificationsTQ?.structuredData?.data.length - 1
            ? globalFocus.currSplit + 1
            : 0;
      }

      navigateTabs(newValue);
    }
  };

  const navigateTabs = (newValue: number) => {
    document.getElementById(`tab-${newValue}`)?.scrollIntoView({
      behavior: inboxConfig.scroll.desktopBehavior,
      inline: "center",
      block: "center",
    });

    setGlobalFocus({ currSplit: newValue, currIdx: 0 });
    const tab = _notificationsTQ?.structuredData?.tabs?.[newValue];
    const isProjectSplit = tab?.projectId != null;
    const projectIdParam = isProjectSplit ? `&projectId=${tab.projectId}` : "";
    const tutorialParams = queryParams?.tutorial === "1" ? "&tutorial=1" : "";
    router.replace(
      `/inbox?split=${encodeURIComponent(tab.project)}${projectIdParam}${tutorialParams}`,
    );

    if (trigger !== undefined) setTrigger(undefined);
    setInitialIndexReset(0);
  };

  // =============================== mark as unread function
  const updateUnseenNotification = async (notificationId: string) => {
    const notification = _notificationsTQ?.notifications.find(
      (item) => item.id === notificationId,
    );
    if (!notification) return;
    const cachePayload = updateInboxOptimistically({
      queryClient,
      queryKey: inboxDataQueryKey(currentUser.id),
      accountId: currentUser.id,
      mutation: {
        type: "set_seen",
        notificationId,
        seen: !notification.seen,
      },
    });
    if (!cachePayload) return;

    _setNotifications(cachePayload.structuredData.data);
  };

  // =============================== mark as unread function
  const starTaskUpdateInCache = async (notification: INotification) => {
    const response = await starTask(
      notification.taskId,
      notification.projectId,
    );
    let content: ISavedContent[] = [];
    if (response.status === 200) {
      content.push({ ...response.data });
      toast(`Starred Task ${notification.task?.ticketNumber?.toUpperCase()}`);
    } else
      toast(`Unstarred Task ${notification.task?.ticketNumber?.toUpperCase()}`);
    const cachePayload = updateInboxOptimistically({
      queryClient,
      queryKey: inboxDataQueryKey(currentUser.id),
      accountId: currentUser.id,
      mutation: {
        type: "set_saved_content",
        notificationId: notification.id,
        savedContent: content,
      },
    });
    if (!cachePayload) return;
    _setNotifications(cachePayload.structuredData.data);
    await queryClient.invalidateQueries({
      queryKey: inboxDataQueryKey(currentUser.id),
      exact: true,
    });
  };

  // =============================== archive function
  const markAsDone = async (
    notification: INotification,
    index: number,
    mode: TRemoveFromInboxMode,
  ) => {
    await archiveNotificationGetter(notification, mode, undoHandler);
  };

  // undoHandler function
  const undoHandler = async (data: any, toastId: string) => {
    await undoAction("UNDO_INBOX_ARCHIVE", data);
    const undoQueryKey = data.queryKey ?? inboxDataQueryKey(currentUser.id);
    await restoreInboxAfterUndo({
      queryClient,
      queryKey: undoQueryKey,
      accountId: currentUser.id,
      notification: data.notification,
      beforeNotificationId: data.beforeNotificationId,
      afterNotificationId: data.afterNotificationId,
    });
    toast.dismiss(toastId);
    toast("Undo notification archive");
  };

  const toggleCreateTask = useCallback(() => {
    if (!visibleNotifications || visibleNotifications.length === 0)
      return toggleCreateTaskGlobally();
    if (
      !visibleNotifications[globalFocus.currSplit] ||
      visibleNotifications[globalFocus.currSplit].length === 0
    )
      return toggleCreateTaskGlobally();
    const task: ITask =
      visibleNotifications[globalFocus.currSplit][globalFocus.currIdx].task;
    toggleCreateTaskGlobally({
      sectionId: task.sectionId!,
      sectionTitle: task.section,
      position: "top",
      projectId:
        visibleNotifications[globalFocus.currSplit][globalFocus.currIdx]
          .projectId,
    });
  }, [_notifications, globalFocus, visibleNotifications]);

  const createSubTask = useCallback(() => {
    if (!_notifications) return;
    if (!_notifications[globalFocus.currIdx]) return;
    const task: ITask = _notifications[globalFocus.currIdx].task;
    toggleCreateTaskGlobally({
      sectionId: task.sectionId!,
      sectionTitle: task.section,
      position: "top",
      parentTask: {
        title: task.title,
        id: task.id,
        ticketNumber: task.ticketNumber,
      },
    });
  }, [_notifications, globalFocus]);

  // HTPR-6160: the biggest piles in the tab you are looking at, offered in Ctrl+K.
  // HTC rebuilds its whole command registry whenever this object's identity
  // changes, and visibleNotifications is keyed on the whole globalFocus object,
  // so this memo does re-run as focus moves. That is bounded rather than fixed:
  // HypertasksCommands only mounts while showCommands.show is true, and the
  // palette owns the keyboard while it is open, so inbox focus is not moving
  // then. The guard below keeps the scan itself off the closed-palette path.
  const currentSplitNotifications: INotification[] =
    visibleNotifications?.[globalFocus.currSplit] ?? NO_NOTIFICATIONS;
  const commandContextOptions: IAllCommands = useMemo(
    () => ({
      context: "Others",
      inboxClusters: showCommands.show
        ? topInboxClusters(currentSplitNotifications)
        : [],
    }),
    [currentSplitNotifications, showCommands.show],
  );

  const archiveInboxCluster = (notificationId: string) => {
    // Every split, not just the one the command was built from: the palette holds
    // a snapshot, and switching tabs while it is open must not turn Enter into a
    // silent no-op. markAsDone archives by notification identity and never
    // forwards its index argument, so the per-split walk exists only to keep that
    // argument truthful in its own split rather than a flattened position.
    for (const split of visibleNotifications ?? []) {
      const index = split.findIndex(
        (notification: INotification) => String(notification.id) === notificationId,
      );
      // Archiving one row already archives that ticket's whole pile server-side
      // (markAsDone), and this reuses the row's undo wiring unchanged.
      if (index >= 0) return void markAsDone(split[index], index, "Notification");
    }
    // Only reachable once the pile is already gone, so say so rather than
    // leaving Enter looking broken.
    toast("That ticket's notifications are already archived");
  };

  const htcCallbackHandler = (payload: any, mode: string) => {
    if (mode === "CreateSubTask") {
      createSubTask();
    }
    if (mode === "ArchiveInboxCluster" && typeof payload === "string") {
      archiveInboxCluster(payload);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    lastgClick.current,
    ,
    _selectedInbox,
    globalFocus.currSplit,
    showShortucts,
    showCommands.show,
    undoData,
    globalFocus,
    trigger,
    toggleCreateTask,
  ]);

  // One effect on purpose: a keyword change resets focus to the top, and only
  // a same-keyword shrink (archive while filtered) clamps it. Split in two,
  // the clamp reads the pre-reset index and wins the race, landing focus on
  // the last match instead of the first.
  const prevInboxSearchRef = useRef(inboxSearch);
  useEffect(() => {
    if (prevInboxSearchRef.current !== inboxSearch) {
      prevInboxSearchRef.current = inboxSearch;
      setGlobalFocus((prev) => ({ ...prev, currIdx: 0 }));
      return;
    }
    if (!visibleNotifications || !inboxSearch.trim()) return;
    setGlobalFocus((prev) => {
      const maxIdx = Math.max(
        0,
        (visibleNotifications[prev.currSplit]?.length ?? 1) - 1,
      );
      return prev.currIdx > maxIdx ? { ...prev, currIdx: maxIdx } : prev;
    });
  }, [inboxSearch, visibleNotifications, setGlobalFocus]);

  const initialScroll = async () => {
    if (visibleNotifications) {
      if (!visibleNotifications[globalFocus.currSplit])
        setGlobalFocus({
          currSplit: inboxConfig.navigation.defaultSplitIndex,
          currIdx: 0,
        });
      const notificationId =
        visibleNotifications[globalFocus.currSplit][initialIndexReset]?.id;
      const element = document.getElementById(`inbox-${notificationId}`);
      if (element) {
        if (window.innerWidth < 760) {
          element.scrollIntoView({
            block: "center",
            behavior: inboxConfig.scroll.mobileBehavior,
          });
        } else {
          element.scrollIntoView({
            block: "center",
            behavior: inboxConfig.scroll.desktopBehavior,
          });
        }
      }
    }
  };

  const newCommentsHandler = () => {
    try {
      // HTPR-4877: setGlobalFocus does not apply until the next render, so the
      // rest of this pass still saw the old currSplit. Splits appear and vanish
      // as their counts hit zero, so indexing a split that is already gone threw
      // on data[gone][idx] and the surrounding catch swallowed it: no crash, just
      // a silently skipped focus and scroll. Resolve the index once, up front,
      // and use that everywhere below.
      const splits = _notificationsTQ?.structuredData?.data;
      let effectiveSplit = globalFocus?.currSplit ?? 0;

      if (splits && !splits[effectiveSplit]) {
        effectiveSplit = inboxConfig.navigation.defaultSplitIndex;
        setGlobalFocus({ currSplit: effectiveSplit, currIdx: 0 });
      } else if (trigger === "ShowAll" && splits) {
        effectiveSplit = splits.length - 1;
        setGlobalFocus({ currSplit: effectiveSplit, currIdx: 0 });
      }

      _setNotifications(_notificationsTQ?.structuredData?.data);
      setNotifications(_notificationsTQ?.structuredData?.data[0]);
      _notificationsTQ?.structuredData?.data[0] &&
        _notificationsTQ?.structuredData?.data[0][globalFocus.currIdx ?? 0] &&
        setSelectedInbox(
          _notificationsTQ?.structuredData?.data[0][globalFocus.currIdx ?? 0],
        );

      const inboxElement = document.getElementById(
        `inbox-${splits?.[effectiveSplit]?.[globalFocus.currIdx ?? 0]?.id}`,
      );
      if (!inboxElement)
        document.getElementById(`tab-${effectiveSplit}`)?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          inline: "center",
          block: "center",
        });
      else {
        inboxElement?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "center",
        });
      }
    } catch (error) {
      console.log("🚀 ~ newCommentsHandler ~ error:", error);
    }
  };

  useEffect(() => {
    newCommentsHandler();
  }, [_notificationsTQ?.structuredData?.data, trigger]);

  // Set active split on initial render when notifications first load: URL-selected split, or the first tab.
  useEffect(() => {
    const tabs = _notificationsTQ?.structuredData?.tabs ?? [];
    const initialSplitIndex = getInitialInboxSplitIndex({
      tabs,
      split: preselectedSplit,
      projectId: preselectedProject,
      urlSelectionProcessed: preselectedSplitProcessed.current,
      defaultSelectionProcessed: initialResetToFirstDone.current,
    });
    if (initialSplitIndex === null) return;

    if (preselectedProject || preselectedSplit) {
      preselectedSplitProcessed.current = true;
    } else {
      initialResetToFirstDone.current = true;
    }
    navigateTabs(initialSplitIndex);
  }, [
    _notificationsTQ?.structuredData?.tabs,
    preselectedProject,
    preselectedSplit,
  ]);

  const handleBulkArchive = async (selectedNotifications: INotification[]) => {
    await bulkArchiveNotifications(
      selectedNotifications,
      "Notification", // or "Task" based on your logic
      bulkUndoHandler,
    );
  };

  // Bulk undo handler
  const bulkUndoHandler = async (data: any, toastId: string) => {
    await undoAction("UNDO_INBOX_ARCHIVE", data);
    queryClient.refetchQueries({ queryKey: inboxConfig.undo.queryKey });
    toast.dismiss(toastId);
  };
  const { isInboxZero } = useInboxZeroStyling();

  return (
    <>
      <span
        aria-hidden="true"
        className="hidden"
        data-tutorial-inbox-loaded={
          notificationsQuery.isFetched && notificationsQuery.isSuccess
            ? "true"
            : "false"
        }
      />
      {appShellRailOn && (
        <AppShellRail
          variant="global"
          currentUser={currentUser}
          notificationsCount={_notificationsTQ?.notifications?.length ?? 0}
          notificationsUnseen={
            _notificationsTQ?.notifications?.filter(
              (notification: INotification) => !notification.seen,
            ).length ?? 0
          }
        />
      )}
      {/* Conditional background - only show when inbox is zero */}
      <div
        className={`fixed inset-0 z-0 transition-all duration-700 ease-in-out ${
          isInboxZero ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <InboxZeroState className="w-full h-full" showContent={true} />
      </div>

      <div className="inbox_header hidden sm:visible bg-transparent">
        <h1
          className="pb-1 pl-4 block sm:hidden z-10"
          style={{ fontSize: "1.2rem", fontWeight: "500" }}
        >
          Comments
        </h1>
      </div>
      <BulkSelectionProvider
        handleBulkArchive={handleBulkArchive}
        resetSelectionKey={inboxSearch.trim()}
        allItems={
          visibleNotifications
            ?.flatMap((inner) => inner.flatMap((n) => n))
            .filter(
              (notification) =>
                !notification.waitingOnSynthetic &&
                !String(notification.id).startsWith("-"),
            )
            .reduce((acc: INotification[], curr) => {
              if (!acc.some((item) => item.id === curr.id)) acc.push(curr);
              return acc;
            }, []) ?? []
        }
      >
        <div
          className={`flex items-center justify-center flex-col w-full min-h-fit transition-all duration-200 ease-in-out ${appShellRailOn ? "pl-[var(--app-shell-rail-w,48px)] " : ""}${
            isInboxZero ? "bg-transparent" : "bg-taskDetailPage"
          }`}
        >
          <div
            className={`search_inbox_container min-h-screen inbox_tag_mobile_view ${
              // Rail mode: hug the bottom (12px, matching the card's mx-[12px]
              // gutters) and rise with the quick-tips bar via --quick-tips-h,
              // which the bar publishes while mounted. Legacy mode keeps pb-9.
              appShellRailOn
                ? "pb-[calc(var(--quick-tips-h,0px)+12px)]"
                : "pb-9"
            } flex flex-col items-start transition-all duration-200 ease-in-out ${
              isInboxZero || appShellRailOn
                ? "bg-transparent"
                : "bg-containerBackground"
            }`}
          >
            <SplitTitlesContainer contentGap={appShellRailOn && !isInboxZero}>
              {_notificationsTQ?.structuredData?.tabs.map(
                (tab: InboxTabMeta, index: number, tabs: InboxTabMeta[]) => (
                  <SplitTitle
                    isSelected={globalFocus.currSplit !== index}
                    onClick={() => navigateTabs(index)}
                    key={tab.project?.toString()}
                    tab={tab}
                    trailingAction={
                      !isMbl && index === tabs.length - 1 ? (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Manage inbox splits"
                          onClick={(event) => {
                            event.stopPropagation();
                            setShowManageSplits(true);
                          }}
                          className="group relative flex shrink-0 items-center justify-center self-center px-1 text-text-light-gray pills-gear"
                        >
                          <Settings2 size={14} strokeWidth={1.75} />
                          <Tooltip
                            text="Manage inbox splits"
                            left={-35}
                            bottom={-34}
                            keyCombination={[]}
                          />
                        </span>
                      ) : undefined
                    }
                  />
                ),
              )}
            </SplitTitlesContainer>

            <div
              className={
                appShellRailOn && !isInboxZero
                  ? "inbox-split-panel mx-[12px] flex min-h-0 w-[calc(100%-24px)] flex-1 flex-col overflow-hidden rounded-md bg-containerBackground shadow-md"
                  : "contents"
              }
            >
              {showInboxSearch && (
                <div className="mx-4 mt-3 flex items-center justify-center gap-2 self-start border-b border-light-black-border-1 bg-inherit p-2 font-normal text-meta text-header-text outline-none">
                  <Search size={14} strokeWidth={1.75} />
                  <input
                    autoFocus
                    className="bg-transparent text-white-black outline-none"
                    id="search-inbox-filter-input"
                    value={inboxSearch}
                    placeholder="Find in view..."
                    onChange={(e) => setInboxSearch(e.target.value)}
                    onKeyDown={(e) => {
                      // Escape is handled in the document-level handleKeyDown:
                      // it must win the race against the "Escape leaves the
                      // inbox" branch that lives in the same listener.
                      if (e.key === "Escape") e.preventDefault();
                    }}
                  />
                  <X
                    className="cursor-pointer"
                    size={16}
                    strokeWidth={1.75}
                    onClick={() => {
                      setInboxSearch("");
                      setShowInboxSearch(false);
                    }}
                  />
                </div>
              )}
              <InboxNotifyNudge />
              {visibleNotifications?.map((notification, index) => (
                <>
                  <InboxSplit
                    key={`split-${globalFocus.currSplit}`}
                    updateNotification={updateUnseenNotification}
                    onLoadCallback={initialScroll}
                    selectedReset={_selectedInbox}
                    originProject={originProject}
                    value={globalFocus.currSplit}
                    index={index}
                    selectedSplit={
                      _notificationsTQ?.structuredData?.tabs[
                        globalFocus.currSplit
                      ]?.project ?? ""
                    }
                    _notifications={notification}
                    initialFocus={initialIndexReset}
                    markAsDone={markAsDone}
                    starTaskUpdateInCache={starTaskUpdateInCache}
                    appShellRail={appShellRailOn}
                    reducedSearchActive={inboxSearch.trim().length > 0}
                    draftSearchQuery={inboxSearch}
                  />
                </>
              ))}
            </div>
            {/* Mobile splits live in the docked splits row above the tab bar,
                and the tab bar is the escape hatch, so the old in-page footer
                and floating Back button are both gone on mobile. */}
            {!isMbl && (
              <div
                className={`flex inbox_footer @md:hidden no-scrollbar scrollbar-none  @md:gap-8 w-100 ${
                  isInboxZero ? "bg-transparent" : "bg-hoverCardBackground"
                }  h-20 @md:h-8 inbox_title`}
              >
                {_notificationsTQ?.structuredData?.tabs.map(
                  (
                    tab: {
                      project: any;
                      idx: number;
                      length: number;
                      hasUnseen: boolean;
                    },
                    index: number,
                  ) => (
                    <SplitTitle
                      isSelected={globalFocus.currSplit !== index}
                      onClick={() => navigateTabs(index)}
                      key={tab.project?.toString()}
                      tab={tab}
                    />
                  ),
                )}
              </div>
            )}
            {isMbl && (
              <MobileInboxSplitDock
                tabs={_notificationsTQ?.structuredData?.tabs ?? []}
                activeIndex={globalFocus.currSplit}
                onSelect={navigateTabs}
              />
            )}
          </div>
          {/* Mobile Inbox uses the split dock in the bottom thumb zone. The
              top-bar board switcher remains its route-level escape hatch. */}
          {!isMbl && (
            <Link
              href={homepageRouter}
              style={{
                zIndex: 101,
                position: "fixed",
                bottom: 110,
                right: 16,
                borderRadius: 20,
                justifyContent: "center",
              }}
              className={`absolute @md:hidden cursor-pointer shadow-customshadow-2 flex w-fit px-3  py-[2px] h-fit gap-2  items-center bg-modalBackground text-[#8E9093] `}
            >
              <Image src={Goback} alt="icon" width={28} height={28} />
              <span>Back</span>
            </Link>
          )}
        </div>
        {showCommands.show && (
          <HypertasksCommands
            callbackHandler={htcCallbackHandler}
            contextOptions={commandContextOptions}
          />
        )}
      </BulkSelectionProvider>
      {showManageSplits && (
        <ManageSplitsModal
          userId={currentUser.id}
          onClose={() => setShowManageSplits(false)}
          splitsNoImportant={_notificationsTQ?.splitsNoImportant ?? []}
          tabs={_notificationsTQ?.structuredData?.tabs ?? []}
        />
      )}
    </>
  );
};

export default Inbox;

interface IProps {
  children?: ReactNode;
  contentGap?: boolean;
}
const SplitTitlesContainer: FC<IProps> = ({ children, contentGap = false }) => {
  return (
    <div
      className={`inbox-text-left relative hidden items-baseline pr-[16px] pt-4 ${
        contentGap ? "mx-[12px] w-[calc(100%-24px)] pb-4" : "w-full"
      } responsive-inbox-padding @md:flex @md:gap-[9px] h-full inbox_title overflow-x-auto scrollbar-none no-scrollbar`}
    >
      <div className="pills-row group relative flex grow flex-wrap items-center gap-[9px]">
        {children}
      </div>
      <ButtonGroup />
    </div>
  );
};

const ButtonGroup = () => {
  const { selectedIdsArray, handleBulkArchive } = useBulkSelectionContext();

  return (
    <div className="flex items-center gap-2">
      <div
        className={`transition-all duration-75 ${
          selectedIdsArray.length > 0 ? "flex items-center gap-2" : "hidden"
        }`}
      >
        <button
          className="relative group"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleBulkArchive();
          }}
        >
          <Tooltip
            left={inboxConfig.tooltipOffsets.bulkArchive.left}
            bottom={inboxConfig.tooltipOffsets.bulkArchive.bottom}
            text={`Remove all ${selectedIdsArray.length} selected messages`}
            keyCombination={inboxConfig.keybindings.archiveSelected}
          />
          <ArchiveNotificationIcon
            height={inboxConfig.bulkSelectIconSize}
            width={inboxConfig.bulkSelectIconSize}
            show={true}
          />
        </button>

        <button
          className="relative group"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Tooltip
            left={inboxConfig.tooltipOffsets.bulkReminder.left}
            bottom={inboxConfig.tooltipOffsets.bulkReminder.bottom}
            text={`Set reminder for ${selectedIdsArray.length} selected messages`}
            keyCombination={inboxConfig.keybindings.remindSelected}
          />
          <RemindMeInbox
            height={inboxConfig.bulkSelectIconSize}
            width={inboxConfig.bulkSelectIconSize}
            show={true}
            mode="Bulk"
            shouldShowToolTip={false} // No tooltip for bulk remind
          />
        </button>
      </div>

      {/* The full-width guest CTAs stay in the header row on the inbox. */}
      <GuestAuthLinks />
    </div>
  );
};
