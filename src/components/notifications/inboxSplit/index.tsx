"use client";

import type { INotification, TRemoveFromInboxMode } from "@/models/model";
import { useRouter } from "next/navigation";
import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRecoilState } from "@/lib/state";
import {
  showCommandsAtom,
  tasksPlayListAtom,
  globalNotificationFocusAtom,
  currentProjectAtom,
} from "@/store";
import { markAsUnseen, markNotificationSeen } from "@/utils/api/Inbox";
import Link from "next/link";
import { NotificationProvider } from "@/lib/contexts/NotificationContext";
import NotificationRow, { Seen } from "../NotificationRow";
import RemindMeComponent from "@/components/Modals/RemindMe/RemindMeComponent";
import SwipeableNotificationRow from "./SwipeableNotificationRow";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useGlobalFocusHandler from "@/hooks/Inbox/useGlobalFocusHandler";
import useUpdateInView from "@/hooks/Inbox/useUpdateInView";
import globalConstants from "@/lib/constants";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import SubtaskLinkingModal from "@/components/Modals/SubtaskLinkingModal/SubtaskLinking";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { BulkAction, useBulkActions } from "@/hooks/MultiPages/useBulkActions";
import { KeyCodes, KeyValues } from "@/lib/constants/keyboard-handler";
import BulkActionsInbox from "./bulk-actions-inbox";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import { useBulkSelectionContext } from "@/lib/contexts/Inbox/BulkSelectionContext";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import InboxZeroState from "@/components/Common/InboxZeroState";
import { useInboxZero } from "@/lib/contexts/InboxZeroContext";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { usePrefetchInboxTaskDetail } from "@/hooks/Inbox/usePrefetchInboxTaskDetail";
import { IUserDraft, useGetUserDrafts } from "@/hooks/General/useGetUserDrafts";
import { inboxDataQueryKey } from "@/hooks/Inbox/useGetNotifications";
import { updateInboxOptimistically } from "@/lib/inboxSync/optimistic";
import InboxDraftRow from "@/components/notifications/InboxDraftRow";
import Tooltip from "@/components/Common/Tooltip";
import { jumpToInboxBoundary } from "@/lib/inboxKeyboardNavigation";
import { markTaskDetailNavigationStart } from "@/lib/analytics/taskDetailReadiness";

interface Props {
  onLoadCallback: () => void;
  selectedReset: INotification | null | undefined;
  _notifications: INotification[];
  index: number;
  value: number;
  markAsDone: (
    notification: INotification,
    index: number,
    mode: TRemoveFromInboxMode,
  ) => Promise<void>;
  starTaskUpdateInCache: (notification: INotification) => Promise<void>;
  initialFocus: number;
  updateNotification: (notificationIndex: string) => void;
  originProject: string;
  selectedSplit: string;
  disableRowButtons?: boolean;
  disableBulkActions?: boolean;
  disableNotificationSideEffects?: boolean;
  disableInboxFlow?: boolean;
  appShellRail?: boolean;
  reducedSearchActive?: boolean;
  queryKey?: readonly unknown[];
  draftSearchQuery?: string;
}

type InboxTimelineItem =
  | {
      kind: "notification";
      notification: INotification;
      notificationIndex: number;
      date: Date;
    }
  | {
      kind: "draft";
      draft: IUserDraft;
      date: Date;
    };

interface GroupedInboxItems {
  [key: string]: {
    label: string;
    items: InboxTimelineItem[];
  };
}

const commentIdHash = (commentId: number) =>
  inboxConfig.urls.commentHash(commentId);

// Date grouping utility functions
const getDateGroup = (date: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const notificationDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const daysDiff = Math.floor(
    (today.getTime() - notificationDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysDiff === 0) return "today";
  if (daysDiff === 1) return "yesterday";

  // Calculate start of current week (Monday)
  const currentWeekStart = new Date(today);
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days to Monday
  currentWeekStart.setDate(today.getDate() - daysToMonday);

  // Calculate start of last week (Monday of previous week)
  const lastWeekStart = new Date(currentWeekStart);
  lastWeekStart.setDate(currentWeekStart.getDate() - 7);

  const lastWeekEnd = new Date(currentWeekStart);
  lastWeekEnd.setDate(currentWeekStart.getDate() - 1); // Sunday of last week

  if (notificationDate >= currentWeekStart && notificationDate < yesterday) {
    return "thisWeek";
  }

  if (notificationDate >= lastWeekStart && notificationDate <= lastWeekEnd) {
    return "lastWeek";
  }

  // For older dates, return month-year format as a consistent key
  // Use format: "month-year" for grouping, but display differently
  return `${date.getMonth()}-${date.getFullYear()}`;
};

const getDateGroupLabel = (group: string): string => {
  // If it's a predefined label, return it
  if (
    inboxConfig.dateGrouping.labels[
      group as keyof typeof inboxConfig.dateGrouping.labels
    ]
  ) {
    return inboxConfig.dateGrouping.labels[
      group as keyof typeof inboxConfig.dateGrouping.labels
    ];
  }

  // If it's a month-year format (e.g., "5-2025"), convert to readable format
  const monthYearMatch = group.match(/^(\d+)-(\d+)$/);
  if (monthYearMatch) {
    const monthIndex = parseInt(monthYearMatch[1]);
    const year = monthYearMatch[2];
    return `${inboxConfig.dateGrouping.monthNames[monthIndex]}, ${year}`;
  }

  return group;
};

const groupInboxItemsByDate = (
  items: InboxTimelineItem[],
  oldestFirst = false,
): GroupedInboxItems => {
  const groups: GroupedInboxItems = {};

  const groupedByDate: { [key: string]: InboxTimelineItem[] } = {};

  items.forEach((item) => {
    const group = getDateGroup(item.date);

    if (!groupedByDate[group]) {
      groupedByDate[group] = [];
    }
    groupedByDate[group].push(item);
  });

  Object.values(groupedByDate).forEach((groupItems) => {
    groupItems.sort((left, right) =>
      oldestFirst
        ? left.date.getTime() - right.date.getTime()
        : right.date.getTime() - left.date.getTime(),
    );
  });

  // Separate predefined groups from month-year groups
  const monthYearGroups: string[] = [];

  // Find all month-year groups and sort them
  Object.keys(groupedByDate).forEach((key) => {
    if (!inboxConfig.dateGrouping.order.includes(key)) {
      monthYearGroups.push(key);
    }
  });

  // Sort month-year groups in descending order (most recent first)
  monthYearGroups.sort((a, b) => {
    const [monthA, yearA] = a.split("-").map(Number);
    const [monthB, yearB] = b.split("-").map(Number);

    if (yearA !== yearB) {
      return oldestFirst ? yearA - yearB : yearB - yearA;
    }
    return oldestFirst ? monthA - monthB : monthB - monthA;
  });

  // Process predefined groups first
  const predefinedOrder = oldestFirst
    ? [...inboxConfig.dateGrouping.order].reverse()
    : inboxConfig.dateGrouping.order;
  predefinedOrder.forEach((groupKey) => {
    if (groupedByDate[groupKey] && groupedByDate[groupKey].length > 0) {
      groups[groupKey] = {
        label: getDateGroupLabel(groupKey),
        items: groupedByDate[groupKey],
      };
    }
  });

  // Then process month-year groups
  monthYearGroups.forEach((groupKey) => {
    if (groupedByDate[groupKey] && groupedByDate[groupKey].length > 0) {
      groups[groupKey] = {
        label: getDateGroupLabel(groupKey),
        items: groupedByDate[groupKey],
      };
    }
  });

  return groups;
};

/** Swipe actions are touch-only, so desktop keeps the plain row untouched. */
const MaybeSwipeable = ({
  enabled,
  onArchive,
  onSnooze,
  children,
}: {
  enabled: boolean;
  onArchive: () => void;
  onSnooze: () => void;
  children: ReactNode;
}) =>
  enabled ? (
    <SwipeableNotificationRow onArchive={onArchive} onSnooze={onSnooze}>
      {children}
    </SwipeableNotificationRow>
  ) : (
    <>{children}</>
  );

const InboxSplit = ({
  selectedReset,
  _notifications,
  value,
  updateNotification,
  markAsDone,
  index,
  initialFocus,
  starTaskUpdateInCache,
  selectedSplit,
  disableRowButtons = false,
  disableBulkActions = false,
  disableNotificationSideEffects = false,
  disableInboxFlow = false,
  appShellRail = false,
  reducedSearchActive = false,
  queryKey,
  draftSearchQuery = "",
}: Props) => {
  const isMbl = useContext(MobileViewContext);
  // Notification whose snooze picker is open, set by a right swipe.
  const [snoozeTarget, setSnoozeTarget] = useState<INotification | null>(null);
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom,
  );
  const { goToProjectShortcut } = useProjectQuery();
  const { updateInView } = useUpdateInView({
    value,
    index,
    selectedReset,
    initialFocus,
    _notifications,
  });
  const queryClient = useQueryClient();
  const { moveIdxDown, moveIdxUp } = useGlobalFocusHandler(queryKey);
  const [showCommands, ____] = useRecoilState(showCommandsAtom);
  const [_, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [currentProject, _____] = useRecoilState(currentProjectAtom);
  const [showSubtaskLinkingModal, setShowSubtaskLinkingModal] =
    useState<boolean>(false);
  const currentUser = useCurrentUser();
  const { navigate, navigateToTask } = useHypertasksNavigate();
  const taskRef = useRef<HTMLDivElement>(null);
  const activeSplitRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isApple = useDeviceContext();
  const currentHoveredDiv = useRef<number | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const prefetchHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastgClick = useRef<number | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };
  const { data: userPreferences } = useGetUserPreferences();
  const { drafts } = useGetUserDrafts(currentUser?.id);
  const activeDrafts = useMemo(() => {
    const keyword = draftSearchQuery.trim().toLowerCase();
    const taskIdsInSplit = new Set(
      _notifications.map((notification) => notification.taskId),
    );
    const isAllSplit = selectedSplit === "All";

    return drafts.filter((draft) => {
      if (draft.type !== "Comment" || draft.saved === true) return false;
      if (!isAllSplit && !taskIdsInSplit.has(draft.taskId)) return false;
      if (!keyword) return true;

      return (
        draft.task.title.toLowerCase().includes(keyword) ||
        draft.task.ticketNumber?.toLowerCase().includes(keyword)
      );
    });
  }, [_notifications, draftSearchQuery, drafts, selectedSplit]);
  const prefetchInboxTaskDetail = usePrefetchInboxTaskDetail({
    notifications: _notifications,
    userId: currentUser?.id,
  });
  const classNamesToReturnFrom = [
    "modal-open",
    "ProseMirror ProseMirror-focused",
    undefined,
  ];
  const {
    handleBulkArchive,
    isAllSelected,
    selectAllFromAllTabs,
    selectedIdsArray,
  } = useBulkSelectionContext();
  const { setIsInboxZero } = useInboxZero();
  const groupedInboxItems = useMemo(() => {
    const timelineItems: InboxTimelineItem[] = [
      ..._notifications.map((notification, notificationIndex) => ({
        kind: "notification" as const,
        notification,
        notificationIndex,
        date: new Date(notification.createdAt || 0),
      })),
      ...activeDrafts.map((draft) => ({
        kind: "draft" as const,
        draft,
        date: new Date(draft.updatedAt ?? 0),
      })),
    ];

    return groupInboxItemsByDate(
      timelineItems,
      selectedSplit === "Blocked by you",
    );
  }, [_notifications, activeDrafts, selectedSplit]);
  const groupedInboxEntries = Object.entries(groupedInboxItems);
  const selectAllGroupKey = groupedInboxItems.today
    ? "today"
    : groupedInboxEntries[groupedInboxEntries.length - 1]?.[0];

  const renderSelectAllControl = () =>
    selectedIdsArray.length > 0 ? (
      <>
        <SelectionCheckbox
          className="!border-white-black"
          alwaysVisible
          isChecked={isAllSelected}
          onClick={() => selectAllFromAllTabs()}
        />
        <Tooltip
          shouldReAdjustToViewport
          left={inboxConfig.tooltipOffsets.selectAll.left}
          bottom={inboxConfig.tooltipOffsets.selectAll.bottom}
          text="Select all from here"
          keyCombination={inboxConfig.keybindings.selectAll(isApple)}
        />
        <Tooltip
          shouldReAdjustToViewport
          left={inboxConfig.tooltipOffsets.selectAllGlobal.left}
          bottom={inboxConfig.tooltipOffsets.selectAllGlobal.bottom}
          text="Select all"
          keyCombination={inboxConfig.keybindings.selectAllGlobal(isApple)}
        />
      </>
    ) : null;

  // Only the split the user is actually looking at gets to say whether the
  // inbox is empty. Every split renders its own <InboxSplit> and they are all
  // mounted at once, so without this check one emptied split flipped the shared
  // flag and painted INBOX ZERO over the splits that still had items
  // (HTPR-4872). `value === index` is the same active-split test already used
  // for keyboard shortcuts below.
  const isActiveSplit = value === index;
  useEffect(() => {
    if (!isActiveSplit) return;
    if (!reducedSearchActive) {
      setIsInboxZero(_notifications.length === 0 && activeDrafts.length === 0);
    }
  }, [
    isActiveSplit,
    _notifications.length,
    reducedSearchActive,
    activeDrafts.length,
    setIsInboxZero,
  ]);

  const handleKeyUp = (event: KeyboardEvent) => {
    if (controller[event.keyCode]) {
      controller[event.keyCode].pressed = false;
    }
  };

  const toggleSubtaskLinking = () => {
    setShowSubtaskLinkingModal((prev) => !prev);
  };
  // Define bulk actions for inbox
  const bulkActions: BulkAction<number>[] = [
    {
      key: "archive",
      label: "Archive",
      keyboardShortcut: [KeyCodes.E],
      handler: handleBulkArchive,
    },
    {
      key: "remind",
      label: "Set Reminder",
      keyboardShortcut: [KeyCodes.H],
      handler: (selectedNotifications) => {
        // Set reminders for all selected notifications
        // Implementation depends on your reminder API
        console.log("Setting reminders for:", selectedNotifications);
      },
    },
  ];
  // In InboxSplit component
  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    handleKeyDown: bulkHandleKeyDown,
  } = useBulkActions({
    items: _notifications.map((x) => ({ ...x, id: parseInt(x.id) })),
    actions: bulkActions,
    enableKeyboardShortcuts: value === index && !disableBulkActions,
  });

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (value !== index) return;
    if (
      e.target instanceof Element &&
      e.target.closest('[data-inbox-draft-control="true"]')
    ) {
      return;
    }
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (controller[e.keyCode]) {
      controller[e.keyCode].pressed = true;
    }
    const bulkResult = bulkHandleKeyDown(e, globalFocus.currIdx);

    // If bulk action handled it, check if we need to update focus
    if (e.defaultPrevented) {
      if (
        bulkResult?.newFocusIndex !== undefined &&
        bulkResult.newFocusIndex !== null
      ) {
        setGlobalFocus((prev) => ({
          ...prev,
          currIdx: bulkResult.newFocusIndex!,
        }));
        return;
      }
    }
    if (
      returnIfModalOrInputActive() ||
      showCommands.show ||
      document?.activeElement?.role === "dialog" ||
      document?.activeElement?.id === "modalButtons" ||
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.id === "htc" ||
      classNamesToReturnFrom.includes(document?.activeElement?.className) ||
      document.activeElement?.id === "boardManager"
    )
      return;

    // --- G key sequence handling start ---

    // Helper: check if a g-sequence is available and matches a target key
    const gSequenceActive = () => {
      const now = new Date().getTime();
      return (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.interactions.keyboard.gKeyDelayMs
      );
    };

    // [g] then [g]: Jump to top/bottom row
    if (
      controller[KeyCodes.G]?.pressed &&
      e.keyCode === KeyCodes.G &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      e.preventDefault();
      const targetIndex = jumpToInboxBoundary(
        _notifications,
        e.shiftKey,
        (rowId) =>
          Array.from(
            activeSplitRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [],
          ).find((element) => element.id === rowId) ?? null,
      );
      if (targetIndex !== null) {
        setGlobalFocus((prev) => ({
          ...prev,
          currIdx: targetIndex,
        }));
      }
      // Prevent further G combos after this triggers
      return;
    }

    // [g] then [t]: Go to project page
    if (
      controller[KeyCodes.T]?.pressed &&
      e.keyCode === KeyCodes.T &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      const focusedProjectId = _notifications[globalFocus.currIdx]?.projectId;
      if (!focusedProjectId || focusedProjectId === currentProject?.id)
        router.push("/");
      else goToProjectShortcut(focusedProjectId, true);
      // Prevent further G combos after this triggers
      return;
    }

    // [g] then [d]: Go to drafts
    if (
      controller[KeyCodes.D]?.pressed &&
      e.keyCode === KeyCodes.D &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      navigate("Drafts");
      return;
    }

    // [g] then [u]: Go to scheduled tasks
    if (
      controller[KeyCodes.U]?.pressed &&
      e.keyCode === KeyCodes.U &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      navigate("Scheduled");
      return;
    }

    // [g] - capture sequence initiation only if previous was NOT G or T combo
    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, inboxConfig.interactions.keyboard.gKeyDelayMs);
      return; // Do not let a plain [g] fall through to [enter] or others
    }

    // --- G key sequence handling end ---

    if (e.keyCode === KeyCodes.ENTER) {
      e.preventDefault();
      openTask("view");
    }

    // pressing r for reply
    if (e.keyCode === KeyCodes.R && cmdControl) openTask("reply");
    // [alt][v] for audio reply
    else if (e.keyCode === KeyCodes.V && e.altKey && !e.shiftKey)
      openTask("audio");
    // ================ arrow for down movement, [j]
    else if (e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN) {
      e.preventDefault();
      const newIdx = await moveIdxDown(_notifications);

      // Update anchor if not in selection mode
      // if (!e.shiftKey && selectedCount === 0) {
      //   updateAnchor(newIdx)
      // }
      return;
    }
    // ================ arrow for up movement, [k]
    else if (
      (e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP) &&
      !cmdControl
    ) {
      e.preventDefault();
      const newIdx = moveIdxUp(_notifications);

      // Update anchor if not in selection mode
      // if (!e.shiftKey && selectedCount === 0) {
      //   updateAnchor(newIdx)
      // }
      return;
    }

    if (!_notifications[globalFocus.currIdx]) return;

    // // [t] to go to project page
    // if (e.keyCode === KeyCodes.T && lastgClick.current !== null) {
    //   if (_notifications[globalFocus.currIdx].projectId === currentProject?.id)
    //     router.push("/");
    //   else
    //     goToProjectShortcut(
    //       _notifications[globalFocus.currIdx].projectId,
    //       true
    //     );
    // }

    // [cmd/ctrl][shift][o] createSubTask
    if (e.keyCode === KeyCodes.O && e.shiftKey && cmdControl) {
      e.preventDefault();
      toggleSubtaskLinking();
    }

    // [u] for unread
    if (e.keyCode === KeyCodes.U && _notifications[globalFocus.currIdx]?.id) {
      updateNotification(_notifications[globalFocus.currIdx]?.id);
      void markAsUnseen(
        Number.parseInt(_notifications[globalFocus.currIdx]?.id),
        _notifications[globalFocus.currIdx].seen,
      ).finally(() =>
        queryClient.invalidateQueries({
          queryKey: queryKey ?? inboxDataQueryKey(currentUser?.id),
          exact: true,
        }),
      );
    } else if (
      e.keyCode === KeyCodes.E ||
      (e.keyCode === KeyCodes.E && cmdControl)
    ) {
      e.preventDefault();
      eHandler(cmdControl);
    }

    if (e.keyCode === KeyCodes.S && e.altKey) {
      e.preventDefault();
      return starTaskUpdateInCache(_notifications[globalFocus.currIdx]);
    }
  };

  // =============== [e] mark as done handler
  //This is where the error is coming from ofcourse.
  const eHandler = (cmdControl: boolean, specificIndex?: number) => {
    if (selectedIdsArray.length > 0) return;
    if (lastgClick.current !== null) {
    } else {
      // Use specificIndex if provided (e.g., from mobile click), otherwise use globalFocus
      const targetIndex =
        specificIndex !== undefined ? specificIndex : globalFocus.currIdx;
      if (_notifications[targetIndex])
        void markAsDone(
          _notifications[targetIndex],
          index,
          cmdControl ? "Task" : "Notification",
        );
    }
  };

  const clearPrefetchHoverTimeout = useCallback(() => {
    if (!prefetchHoverTimeout.current) return;
    clearTimeout(prefetchHoverTimeout.current);
    prefetchHoverTimeout.current = null;
  }, []);

  const handleMouseEnter = (index: number) => {
    currentHoveredDiv.current = index;
    clearPrefetchHoverTimeout();
    prefetchHoverTimeout.current = setTimeout(() => {
      prefetchInboxTaskDetail(index);
      prefetchHoverTimeout.current = null;
    }, 80);

    if (debounceTimeout.current) {
      setGlobalFocus((prev) => ({ ...prev, currIdx: index }));
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
  };

  const handleMouseLeave = () => {
    clearPrefetchHoverTimeout();

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
      debounceTimeout.current = null;
    }
    debounceTimeout.current = setTimeout(() => {
      if (currentHoveredDiv.current !== null && taskRef.current) {
        (taskRef.current as HTMLDivElement)?.blur();
        currentHoveredDiv.current = null;
      }
    }, inboxConfig.interactions.hover.debounceMs);
  };

  const handleTouchStart = useCallback(
    (index: number) => {
      clearPrefetchHoverTimeout();
      prefetchInboxTaskDetail(index);
    },
    [clearPrefetchHoverTimeout, prefetchInboxTaskDetail],
  );

  // const handleMouseMove = () => {
  //   if (debounceTimeout.current) {
  //     setGlobalFocus((prev) => ({ ...prev, currIdx: currentHoveredDiv.current ? currentHoveredDiv.current : 0 }))
  //     clearTimeout(debounceTimeout.current)
  //     debounceTimeout.current = null
  //   }
  // }

  const markSeenOnOpen = (notification: INotification) => {
    if (notification.seen || !notification.id) return;

    const cacheKey = queryKey ?? inboxDataQueryKey(currentUser?.id);
    if (currentUser?.id) {
      updateInboxOptimistically({
        queryClient,
        queryKey: cacheKey,
        accountId: currentUser.id,
        mutation: {
          type: "set_seen",
          notificationId: notification.id,
          seen: true,
        },
      });
    }

    void markNotificationSeen(Number.parseInt(notification.id)).finally(() =>
      queryClient.invalidateQueries({ queryKey: cacheKey, exact: true }),
    );
  };

  // ==================== OPEN TASK ==========================
  const openTask = async (
    mode: string,
    notification: INotification | null = null,
    index?: number,
  ) => {
    const selectedInbox = _notifications[globalFocus.currIdx];
    // Mouse input owns an exact row; keyboard input falls back to focus.
    // Resolve this before any type-specific branch so a focused invitation
    // cannot override a clicked AgentMessage (or vice versa).
    const clickTarget = notification ?? selectedInbox;
    if (!clickTarget) return;

    if (
      clickTarget.type === "Invited" &&
      clickTarget.notification_invite?.inviteURL
    ) {
      return router.push(clickTarget.notification_invite.inviteURL);
    }

    if (clickTarget.type === "AgentMessage" && clickTarget.fromAgentId) {
      // Reuses create-session's upsert on (userId, agentId): this always
      // resolves to the same session the heartbeat posted from, never forks
      // a new thread.
      if (!disableNotificationSideEffects) {
        markSeenOnOpen(clickTarget);
      }
      const res = await fetch("/api/ai-chat/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: clickTarget.fromAgentId }),
      });
      const data = (await res.json().catch(() => null)) as {
        session?: { id: string };
      } | null;
      // Either way, this branch owns the click: never fall through into the
      // task-navigation path below, which assumes a task exists. On failure
      // (e.g. the agent was revoked between notification and click) this is
      // a clean no-op rather than a broken navigation.
      if (data?.session?.id) {
        router.push(`/chat/${data.session.id}`);
      }
      return;
    }

    if (!disableNotificationSideEffects) {
      markSeenOnOpen(clickTarget);
    }

    const tasksPlayList = buildUniqueTasksPlaylist(_notifications);
    setTasksPlayList(tasksPlayList);

    const queryParams = buildQueryParams(mode);

    if (notification) {
      const mentionedQueryParam =
        notification.type === "Mentioned" && notification.commentId
          ? commentIdHash(notification.commentId)
          : "";
      const finalUrl =
        inboxConfig.urls.taskDetail(
          notification.projectId,
          notification.task?.uniqueIndex,
          mentionedQueryParam,
        ) + (disableInboxFlow ? "" : queryParams);
      markTaskDetailNavigationStart("inbox", finalUrl);
      return router.push(finalUrl);
    }

    const projectName = selectedInbox.project?.name;
    const taskIndex = selectedInbox.task?.uniqueIndex;
    const inboxFlowQuery = disableInboxFlow
      ? ""
      : queryParams
        ? `?${inboxConfig.urls.queryParams.inboxFlow}&${queryParams.slice(1)}`
        : `?${inboxConfig.urls.queryParams.inboxFlow}`;
    const mentionedQueryParam =
      selectedInbox.type === "Mentioned" && selectedInbox.commentId
        ? commentIdHash(selectedInbox.commentId)
        : "";
    navigateToTask(
      selectedInbox.project?.id ?? selectedInbox.projectId,
      taskIndex,
      "push",
      `${inboxFlowQuery}${mentionedQueryParam}`,
    );
  };

  const buildUniqueTasksPlaylist = (notifications: INotification[]) => {
    const uniqueMap = new Map<
      string,
      { projectId: number; uniqueIndex: number; notification: any }
    >();
    for (const notification of notifications) {
      if (notification.type === "Invited") continue;
      const key = `${notification.projectId}-${notification.task?.uniqueIndex}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          projectId: notification.projectId,
          uniqueIndex: notification.task?.uniqueIndex,
          notification,
        });
      }
    }
    return Array.from(uniqueMap.values());
  };

  const buildQueryParams = (mode: string): string => {
    switch (mode) {
      case "reply":
        return `&${inboxConfig.urls.queryParams.reply}`;
      case "audio":
        return `&${inboxConfig.urls.queryParams.audio}`;
      default:
        return "";
    }
  };

  useEffect(() => {
    updateInView();
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    _notifications,
    value,
    index,
    _notifications[globalFocus.currIdx],
    showCommands.show,
    globalFocus.currIdx,
    lastgClick,
    globalFocus.currIdx,
    selectedCount,
  ]);

  useEffect(() => {
    if (value !== index) return;
    // Debounced: holding J/K sweeps focus across many rows; prefetch only
    // once focus rests, not per row passed (HTPR-3998).
    const t = setTimeout(
      () => prefetchInboxTaskDetail(globalFocus.currIdx),
      150,
    );
    return () => clearTimeout(t);
  }, [globalFocus.currIdx, index, prefetchInboxTaskDetail, value]);

  useEffect(() => {
    return () => clearPrefetchHoverTimeout();
  }, [clearPrefetchHoverTimeout]);

  return (
    <>
      <div
        ref={activeSplitRef}
        // onMouseMove={handleMouseMove}
        hidden={inboxConfig.visibility.hidden(value, index)}
        style={{
          flex: 1,
          display: inboxConfig.visibility.display(value, index),
          width: "100%",
          flexDirection: "column",
          overflowY: "auto",
        }}
        className={cn(
          // no z-index: this is a normal-flow scroll wrapper, not an overlay.
          // A stray z-100 here used to bury the fixed app-shell rail (z-[60]
          // < 100) under this container's stacking context (HTPR-4906).
          "flex flex-col-reverse relative md:mt-4",
          !inboxConfig.visibility.showBulkActions(selectedCount) && "",
        )}
      >
        {value == index &&
        _notifications.length === 0 &&
        activeDrafts.length === 0 ? (
          selectedIdsArray.length > 0 ? (
            <div className="top-0 z-10 hidden items-center py-2 text-icon-hover-gray backdrop-blur-sm md:flex">
              <div className="w-1 shrink-0" aria-hidden="true" />
              <div className="inbox-row-gutter group relative flex shrink-0 items-center justify-end pr-[1px]">
                {renderSelectAllControl()}
              </div>
              <h3 className="inbox-text-left text-meta font-bold uppercase md:!p-0">
                Selected
              </h3>
            </div>
          ) : null
        ) : (
          value == index &&
          groupedInboxEntries.map(([groupKey, group]) => (
            <div key={groupKey} className="date-group">
              {/* Date Group Header */}
              <div className="top-0 z-10 flex items-center py-2 text-icon-hover-gray backdrop-blur-sm">
                {/* Match the row's 4px focus rail + control gutter so the
                    checkbox and date label align with row controls and text. */}
                <div
                  className="hidden w-1 shrink-0 md:block"
                  aria-hidden="true"
                />
                <div className="inbox-row-gutter group relative hidden shrink-0 items-center justify-end pr-[1px] md:flex">
                  {groupKey === selectAllGroupKey && renderSelectAllControl()}
                </div>
                <h3 className="inbox-text-left text-content font-bold uppercase sm:text-meta md:!p-0">
                  {group.label}
                </h3>
              </div>

              {/* Inbox activity and drafts in this group */}
              <div className="">
                {group.items.map((item) => {
                  if (item.kind === "draft") {
                    return (
                      <div key={`${groupKey}-draft-${item.draft.id}`}>
                        <InboxDraftRow
                          draft={item.draft}
                          activeDrafts={activeDrafts}
                          userId={currentUser!.id}
                        />
                        <div className="message_divider block md:hidden"> </div>
                      </div>
                    );
                  }

                  const { notification, notificationIndex: globalIndex } = item;
                  const mentionedQueryParam =
                    notification.type === "Mentioned" && notification.commentId
                      ? commentIdHash(notification.commentId)
                      : "";
                  const intId = parseInt(notification.id);
                  const selected =
                    _notifications[globalFocus.currIdx]?.id === notification.id;
                  const isBulkSelected = selectedIds.includes(intId);
                  const isWaitingOnSynthetic =
                    notification.waitingOnSynthetic ||
                    String(notification.id).startsWith("-");

                  return (
                    <div
                      className={`${isBulkSelected ? "bulk-active" : ""}`}
                      data-tutorial-inbox-index={globalIndex}
                      data-tutorial-inbox-notification-id={notification.id}
                      data-tutorial-inbox-task-id={
                        notification.taskId ?? undefined
                      }
                      key={`${groupKey}-notification-${notification.id}-${globalIndex}`}
                    >
                      <NotificationProvider
                        selectedIds={selectedIds}
                        selectedSplit={selectedSplit}
                        isIbxSlctd={isBulkSelected}
                        notification={notification}
                        displayAvatar={userPreferences?.displayAvatar}
                      >
                        <MaybeSwipeable
                          enabled={isMbl && !isWaitingOnSynthetic}
                          onArchive={() => eHandler(false, globalIndex)}
                          onSnooze={() => setSnoozeTarget(notification)}
                        >
                          <div
                            className={cn(
                              // gap-[8px] not gap-2: Bootstrap's .gap-2 is !important and unkillable (HTPR-4921)
                              "group/selection_row relative flex items-center gap-[8px] sm:p-inbox-horizontal md:gap-[0px] md:border-l-4 md:p-0",
                              {
                                // Mirror the fixed desktop gutter on the right so row
                                // content stays centred within the available panel.
                                ["sm:pr-[39px] md:pr-[calc(var(--inbox-text-left-offset)-4px)]"]:
                                  !disableRowButtons && !disableBulkActions,
                                [`!bg-[#2178ca] border-[#c5c5c5] !text-white`]:
                                  isBulkSelected && selected,
                                [`!bg-[#2178ca] border-transparent !text-white`]:
                                  isBulkSelected && !selected,
                                ["md:bg-active-elementBg border-l-selected-item-border"]:
                                  selected && !isBulkSelected,
                                ["md:border-l-transparent bg-transparent"]:
                                  !selected && !isBulkSelected,
                              },
                            )}
                            onMouseEnter={() => handleMouseEnter(globalIndex)}
                            onMouseLeave={handleMouseLeave}
                            onTouchStart={() => handleTouchStart(globalIndex)}
                          >
                            {/* Preserve the existing tablet layout; desktop uses the
                             fixed gutter below so controls never move sender text. */}
                            {!disableRowButtons &&
                              !disableBulkActions &&
                              isWaitingOnSynthetic && (
                                <div
                                  className="hidden w-[15px] shrink-0 sm:block md:hidden"
                                  aria-hidden="true"
                                />
                              )}
                            {!disableRowButtons &&
                              !disableBulkActions &&
                              !isWaitingOnSynthetic && (
                                <SelectionCheckbox
                                  // Only emit a bare `visible` while a bulk selection is
                                  // active. At rest the component would default to
                                  // alwaysVisible, whose `visible` class Bootstrap's global
                                  // `.visible{visibility:visible!important}` hijacks, pinning
                                  // the checkbox on. Matches Inbox.tsx / AgentInbox so it's
                                  // hover-only until you start selecting.
                                  alwaysVisible={selectedIdsArray.length > 0}
                                  className={cn(
                                    "bg-transparent border-opacity-30 md:!hidden",
                                    {
                                      ["!bg-transparent border-white"]:
                                        isBulkSelected,
                                      ["group-hover/selection_row:!visible !invisible hover:border-gray-400"]:
                                        !isBulkSelected,
                                    },
                                  )}
                                  groupName="selection_row"
                                  id={intId}
                                  isChecked={isBulkSelected}
                                  checkmarkColorClass="text-white"
                                  onClick={() => toggleSelection(intId)}
                                />
                              )}
                            <div className="inbox-row-gutter hidden shrink-0 items-center justify-end gap-2 pr-[1px] md:flex">
                              {!disableRowButtons &&
                                !disableBulkActions &&
                                (isWaitingOnSynthetic ? (
                                  <div
                                    className="w-[15px] shrink-0"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <SelectionCheckbox
                                    alwaysVisible={selectedIdsArray.length > 0}
                                    className={cn(
                                      "bg-transparent border-opacity-30",
                                      {
                                        "!bg-transparent border-white":
                                          isBulkSelected,
                                        "group-hover/selection_row:!visible !invisible hover:border-gray-400":
                                          !isBulkSelected,
                                      },
                                    )}
                                    groupName="selection_row"
                                    id={intId}
                                    isChecked={isBulkSelected}
                                    checkmarkColorClass="text-white"
                                    onClick={() => toggleSelection(intId)}
                                  />
                                ))}
                              <Seen notification={notification} />
                            </div>
                            {notification.type === "AgentMessage" ? (
                              // No task URL exists for this type (null
                              // projectId, no task) -- the wrapping Link
                              // below would race its own malformed
                              // navigation against openTask's chat redirect.
                              // NotificationRow's own click handling (via
                              // TaskRowContainer's cursor-pointer div) is
                              // enough on its own, same as any non-link
                              // clickable row elsewhere in this file.
                              <div
                                className={
                                  appShellRail ? "min-w-0 flex-1" : "w-full"
                                }
                              >
                                <NotificationRow
                                  index={globalIndex}
                                  taskRef={taskRef}
                                  openTask={openTask}
                                  handleMouseLeave={handleMouseLeave}
                                  handleMouseEnter={handleMouseEnter}
                                  selected={selected}
                                  markAsDone={markAsDone}
                                  eHandler={eHandler}
                                  disableButtons={
                                    disableRowButtons || isWaitingOnSynthetic
                                  }
                                  appShellRail={appShellRail}
                                />
                              </div>
                            ) : (
                              <Link
                                className={
                                  appShellRail ? "min-w-0 flex-1" : "w-full"
                                }
                                onClick={() =>
                                  notification.type !== "Invited" &&
                                  setTasksPlayList(
                                    buildUniqueTasksPlaylist(_notifications),
                                  )
                                }
                                href={
                                  notification.type !== "Invited"
                                    ? inboxConfig.urls.taskDetail(
                                        notification.projectId,
                                        notification.task?.uniqueIndex,
                                        mentionedQueryParam,
                                      )
                                    : (notification.notification_invite
                                        ?.inviteURL ?? "")
                                }
                              >
                                <NotificationRow
                                  index={globalIndex}
                                  taskRef={taskRef}
                                  openTask={openTask}
                                  handleMouseLeave={handleMouseLeave}
                                  handleMouseEnter={handleMouseEnter}
                                  selected={selected}
                                  markAsDone={markAsDone}
                                  eHandler={eHandler}
                                  disableButtons={
                                    disableRowButtons || isWaitingOnSynthetic
                                  }
                                  appShellRail={appShellRail}
                                />
                              </Link>
                            )}
                          </div>
                        </MaybeSwipeable>
                      </NotificationProvider>
                      <div className="message_divider block md:hidden"> </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {snoozeTarget && (
        <RemindMeComponent
          closeHandler={() => setSnoozeTarget(null)}
          isBulkMode
          bulkItems={[
            {
              taskId: snoozeTarget.taskId,
              projectId: snoozeTarget.projectId,
            },
          ]}
        />
      )}

      {showSubtaskLinkingModal && (
        <SubtaskLinkingModal
          closeHandler={toggleSubtaskLinking}
          taskInfo={{
            id: _notifications[globalFocus.currIdx].task.id,
            projectId: _notifications[globalFocus.currIdx].task.projectId,
            section: _notifications[globalFocus.currIdx].task.section,
            sectionId: _notifications[globalFocus.currIdx].task.sectionId!,
            title: _notifications[globalFocus.currIdx].task.title,
            ticketNumber: _notifications[globalFocus.currIdx].task.ticketNumber,
          }}
        />
      )}
    </>
  );
};

export default InboxSplit;
