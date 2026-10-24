"use client";

import { setNotificationSeen } from "@/lib/api/typedClient";
import {
  HTPR_6979_TYPED_WRITES_FLAG,
  HTPR_7311_DECISION_COMMENT_LINK_FLAG,
  SHORTCUT_NUDGES_FLAG,
} from "@/lib/flags/keys";
import { HTPR_5906_NO_PHONE_NUDGES_FLAG } from "@/lib/flags/definitions/htpr-5906-no-phone-nudges";

import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { groupInboxItemsByDate } from "@/lib/inbox/inboxDateGroups";
import { HTPR_7801_INBOX_VISIBLE_ORDER_FLAG } from "@/lib/flags/definitions/htpr-7801-inbox-visible-order";
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
  archiveShortcutNudgeAtom,
  showCommandsAtom,
  tasksPlayListAtom,
  globalNotificationFocusAtom,
  currentProjectAtom,
} from "@/store";
import { useShortcutTipsSetting } from "@/hooks/useShortcutTipsSetting";
import {
  clearArchiveShortcutNudge,
  recordArchiveShortcutAction,
  type ArchiveShortcutSource,
} from "@/lib/notifications/archiveShortcutNudge";
import { markAsUnseen, markNotificationSeen } from "@/utils/api/Inbox";
import Link from "next/link";
import { NotificationProvider } from "@/lib/contexts/NotificationContext";
import NotificationRow, { Seen } from "../NotificationRow";
import dynamic from "next/dynamic";
const RemindMeComponent = dynamic(() => import("@/components/Modals/RemindMe/RemindMeComponent"));
import SwipeableNotificationRow from "./SwipeableNotificationRow";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useUpdateInView from "@/hooks/Inbox/useUpdateInView";
import globalConstants from "@/lib/constants";
import {
  returnIfModalOrInputActive,
  scrollToCenterIfNearBottom,
  scrollToCenterIfNearTop,
} from "@/utils/helperFunctions/helperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import SubtaskLinkingModal from "@/components/Modals/SubtaskLinkingModal/SubtaskLinking";
import { buildInboxTasksPlaylist } from "@/lib/inbox/inboxTasksPlaylist";
import useCurrentUser from "@/hooks/General/useCurrentUserCheckFromCookies";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useFlag } from "@/hooks/useFlag";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { BulkAction, useBulkActions } from "@/hooks/MultiPages/useBulkActions";
import { KeyCodes, KeyValues } from "@/lib/constants/keyboard-handler";
import BulkActionsInbox from "./bulk-actions-inbox";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import { useBulkSelectionContext } from "@/lib/contexts/Inbox/BulkSelectionContext";
import { decisionsSplitName, inboxConfig } from "@/lib/configs/inbox.config";
import { withDecisionCommentAnchor } from "@/lib/inboxDecisions";
import { cn } from "@/utils/undoActions/helperFuncs";
import InboxZeroState from "@/components/Common/InboxZeroState";
import { useInboxZero } from "@/lib/contexts/InboxZeroContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { usePrefetchInboxTaskDetail } from "@/hooks/Inbox/usePrefetchInboxTaskDetail";
import { IUserDraft, useGetUserDrafts } from "@/hooks/General/useGetUserDrafts";
import { inboxDataQueryKey } from "@/hooks/Inbox/useGetNotifications";
import { updateInboxOptimistically } from "@/lib/inboxSync/optimistic";
import InboxDraftRow from "@/components/notifications/InboxDraftRow";
import Tooltip from "@/components/Common/Tooltip";
import {
  getAdjacentInboxKeyboardRow,
  jumpToInboxBoundary,
  reconcileInboxKeyboardRow,
} from "@/lib/inboxKeyboardNavigation";
import toast from "react-hot-toast";

interface Props {
  onLoadCallback: () => void;
  onContentReady?: () => void;
  selectedReset: INotification | null | undefined;
  _notifications: INotification[];
  index: number;
  value: number;
  markAsDone: (
    notification: INotification,
    index: number,
    mode: TRemoveFromInboxMode,
  ) => Promise<boolean | void>;
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

type InboxKeyboardTimelineRow = {
  key: string;
  domId: string;
  item: InboxTimelineItem;
};

const commentIdHash = (commentId: number) =>
  inboxConfig.urls.commentHash(commentId);

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
  onContentReady,
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
  const snapshot = useFirstScreenSurface();
  const inboxDocument = getInboxDocument(snapshot, snapshot?.scope.accountId ?? 0);
  const isMbl = useContext(MobileViewContext);
  const [snoozeTarget, setSnoozeTarget] = useState<INotification | null>(null);
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom,
  );
  const [activeKeyboardRowKey, setActiveKeyboardRowKey] = useState<
    string | null
  >(null);
  const { goToProjectShortcut } = useProjectQuery();
  const { updateInView } = useUpdateInView({
    value,
    index,
    selectedReset,
    initialFocus,
    _notifications,
  });
  const queryClient = useQueryClient();
  const [showCommands, ____] = useRecoilState(showCommandsAtom);
  const [_, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [currentProject, _____] = useRecoilState(currentProjectAtom);
  const { tipsEnabled } = useShortcutTipsSetting();
  const [, setArchiveNudge] = useRecoilState(archiveShortcutNudgeAtom);
  const typedWrites = useFlag(HTPR_6979_TYPED_WRITES_FLAG);
  let typedWrite: typeof setNotificationSeen | undefined;
  if (typedWrites) typedWrite = setNotificationSeen;
  const shortcutNudgesEnabled = useFlag(SHORTCUT_NUDGES_FLAG);
  const noPhoneNudges = useFlag(HTPR_5906_NO_PHONE_NUDGES_FLAG) && isMbl;
  const [showSubtaskLinkingModal, setShowSubtaskLinkingModal] =
    useState<boolean>(false);
  const currentUser = useCurrentUser() ?? inboxDocument?.data.user;
  const decisionCommentLinkEnabled = useFlag(HTPR_7311_DECISION_COMMENT_LINK_FLAG);
  const inboxVisibleOrder = useFlag(HTPR_7801_INBOX_VISIBLE_ORDER_FLAG);
  let decisionCommentLinks = false;
  if (decisionCommentLinkEnabled) {
    decisionCommentLinks = selectedSplit === decisionsSplitName;
  }
  const { navigate, navigateToTask } = useHypertasksNavigate();
  const taskRef = useRef<HTMLDivElement>(null);
  const activeSplitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (value === index) onContentReady?.();
  }, [value, index, onContentReady]);
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
  const { data: userPreferences, dataUpdatedAt: preferencesUpdatedAt } = useGetUserPreferences();
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
      snapshot,
    );
  }, [_notifications, activeDrafts, selectedSplit, snapshot]);
  const groupedInboxEntries = Object.entries(groupedInboxItems);
  const keyboardRows = useMemo<InboxKeyboardTimelineRow[]>(
    () =>
      Object.values(groupedInboxItems).flatMap(({ items }) =>
        items.map((item) =>
          item.kind === "draft"
            ? {
                key: `draft-${item.draft.id}`,
                domId: `inbox-draft-${item.draft.id}`,
                item,
              }
            : {
                key: `notification-${item.notification.id}`,
                domId: `inbox-${item.notification.id}`,
                item,
              },
        ),
      ),
    [groupedInboxItems],
  );
  const fallbackKeyboardRowKey =
    keyboardRows.find(
      (row) =>
        row.item.kind === "notification" &&
        row.item.notificationIndex === globalFocus.currIdx,
    )?.key ?? null;
  const selectedKeyboardRow = reconcileInboxKeyboardRow(
    keyboardRows,
    activeKeyboardRowKey,
    fallbackKeyboardRowKey,
  );
  const selectedKeyboardNotificationIndex =
    selectedKeyboardRow?.item.kind === "notification"
      ? selectedKeyboardRow.item.notificationIndex
      : null;
  const selectAllGroupKey = groupedInboxItems.today
    ? "today"
    : groupedInboxEntries[groupedInboxEntries.length - 1]?.[0];

  const focusKeyboardRow = (
    row: InboxKeyboardTimelineRow,
    direction?: -1 | 1,
  ) => {
    setActiveKeyboardRowKey(row.key);
    if (row.item.kind === "notification") {
      const notificationIndex = row.item.notificationIndex;
      setGlobalFocus((previous) => ({
        ...previous,
        currIdx: notificationIndex,
      }));
    }
    const activeElement = activeSplitRef.current?.querySelector<HTMLElement>(
      `[id="${row.domId}"]`,
    );
    if (activeElement && direction === -1) {
      scrollToCenterIfNearTop(activeElement);
    } else if (activeElement && direction === 1) {
      scrollToCenterIfNearBottom(activeElement);
    }
  };

  const openDraft = (draft: IUserDraft) => {
    setTasksPlayList(
      activeDrafts.map(({ task }) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      })),
    );
    navigateToTask(
      draft.task.projectId,
      draft.task.uniqueIndex,
      "push",
      `?${inboxConfig.urls.queryParams.inboxFlow}&${inboxConfig.urls.queryParams.reply}`,
    );
  };

  const renderSelectAllControl = () =>
    selectedIdsArray.length > 0 ? (
      <>
        <SelectionCheckbox
          className="!border-white-black mr-2"
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

  const isActiveSplit = value === index;
  useEffect(() => {
    if (!isActiveSplit) return;

    const selectedKey = selectedKeyboardRow?.key ?? null;
    if (activeKeyboardRowKey !== selectedKey) {
      setActiveKeyboardRowKey(selectedKey);
    }
    if (
      selectedKeyboardNotificationIndex !== null &&
      selectedKeyboardNotificationIndex !== globalFocus.currIdx
    ) {
      setGlobalFocus((previous) => ({
        ...previous,
        currIdx: selectedKeyboardNotificationIndex,
      }));
    }
  }, [
    activeKeyboardRowKey,
    globalFocus.currIdx,
    isActiveSplit,
    selectedKeyboardNotificationIndex,
    selectedKeyboardRow?.key,
    setGlobalFocus,
  ]);

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
        console.log("Setting reminders for:", selectedNotifications);
      },
    },
  ];
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
    const bulkResult =
      selectedKeyboardNotificationIndex === null
        ? undefined
        : bulkHandleKeyDown(e, selectedKeyboardNotificationIndex);

    if (e.defaultPrevented) {
      if (
        bulkResult?.newFocusIndex !== undefined &&
        bulkResult.newFocusIndex !== null
      ) {
        const targetRow = keyboardRows.find(
          (row) =>
            row.item.kind === "notification" &&
            row.item.notificationIndex === bulkResult.newFocusIndex,
        );
        if (targetRow) focusKeyboardRow(targetRow);
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


    const gSequenceActive = () => {
      const now = new Date().getTime();
      return (
        lastgClick.current &&
        now - lastgClick.current < inboxConfig.interactions.keyboard.gKeyDelayMs
      );
    };

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
        const targetRow = keyboardRows.find(
          (row) =>
            row.item.kind === "notification" &&
            row.item.notificationIndex === targetIndex,
        );
        if (targetRow) focusKeyboardRow(targetRow);
      }
      return;
    }

    if (
      controller[KeyCodes.T]?.pressed &&
      e.keyCode === KeyCodes.T &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      const focusedProjectId =
        selectedKeyboardRow?.item.kind === "draft"
          ? selectedKeyboardRow.item.draft.task.projectId
          : selectedKeyboardRow?.item.notification.projectId;
      if (!focusedProjectId || focusedProjectId === currentProject?.id)
        router.push("/");
      else goToProjectShortcut(focusedProjectId, true);
      return;
    }

    if (
      controller[KeyCodes.D]?.pressed &&
      e.keyCode === KeyCodes.D &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      navigate("Drafts");
      return;
    }

    if (
      controller[KeyCodes.U]?.pressed &&
      e.keyCode === KeyCodes.U &&
      gSequenceActive()
    ) {
      lastgClick.current = null;
      navigate("Scheduled");
      return;
    }

    if (e.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastgClick.current = now;
      setTimeout(() => {
        lastgClick.current = null;
      }, inboxConfig.interactions.keyboard.gKeyDelayMs);
      return;
    }


    if (e.keyCode === KeyCodes.ENTER) {
      e.preventDefault();
      if (selectedKeyboardRow?.item.kind === "draft") {
        openDraft(selectedKeyboardRow.item.draft);
      } else {
        openTask("view");
      }
      return;
    }

    if (e.keyCode === KeyCodes.R && cmdControl) {
      e.preventDefault();
      if (selectedKeyboardRow?.item.kind === "draft") {
        openDraft(selectedKeyboardRow.item.draft);
        return;
      }
      openTask("reply");
    }
    else if (
      e.keyCode === KeyCodes.V &&
      e.altKey &&
      !e.shiftKey &&
      selectedKeyboardRow?.item.kind === "notification"
    )
      openTask("audio");
    else if (e.keyCode === KeyCodes.J || e.keyCode === KeyCodes.ARROW_DOWN) {
      e.preventDefault();
      const targetRow = getAdjacentInboxKeyboardRow(
        keyboardRows,
        selectedKeyboardRow?.key ?? null,
        1,
      );
      if (targetRow) focusKeyboardRow(targetRow, 1);
      return;
    }
    else if (
      (e.keyCode === KeyCodes.K || e.keyCode === KeyCodes.ARROW_UP) &&
      !cmdControl
    ) {
      e.preventDefault();
      const targetRow = getAdjacentInboxKeyboardRow(
        keyboardRows,
        selectedKeyboardRow?.key ?? null,
        -1,
      );
      if (targetRow) focusKeyboardRow(targetRow, -1);
      return;
    }

    if (selectedKeyboardRow?.item.kind !== "notification") return;


    if (e.keyCode === KeyCodes.O && e.shiftKey && cmdControl) {
      e.preventDefault();
      toggleSubtaskLinking();
    }

    const selectedNotification = selectedKeyboardRow.item.notification;
    if (e.keyCode === KeyCodes.U && selectedNotification.id) {
      updateNotification(selectedNotification.id);
      void markAsUnseen(
        Number.parseInt(selectedNotification.id),
        selectedNotification.seen,
        undefined,
        typedWrite,
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
      void eHandler(cmdControl, undefined, "keyboard");
    }

    if (e.keyCode === KeyCodes.S && e.altKey) {
      e.preventDefault();
      return starTaskUpdateInCache(selectedNotification);
    }
  };

  const eHandler = async (
    cmdControl: boolean,
    specificIndex: number | undefined,
    source: ArchiveShortcutSource,
  ) => {
    if (selectedIdsArray.length > 0) return;
    if (lastgClick.current !== null) {
    } else {
      let targetNotification: INotification | undefined;
      if (specificIndex !== undefined) {
        targetNotification = _notifications[specificIndex];
      } else if (selectedKeyboardRow?.item.kind === "notification") {
        targetNotification = selectedKeyboardRow.item.notification;
      }
      if (targetNotification) {
        const accountId = currentUser?.id;
        const enabled = shortcutNudgesEnabled && tipsEnabled && !noPhoneNudges;
        if (source === "keyboard" && typeof accountId === "number") {
          setArchiveNudge((current) =>
            clearArchiveShortcutNudge(current, accountId),
          );
        }
        let succeeded = false;
        try {
          const result = await markAsDone(
            targetNotification,
            index,
            cmdControl ? "Task" : "Notification",
          );
          succeeded = result !== false;
        } catch (error) {
          console.error("Inbox archive failed", error);
          toast.error("Could not archive this notification");
        }
        if (source === "mouse" && typeof accountId === "number") {
          setArchiveNudge((current) =>
            recordArchiveShortcutAction(current, {
              accountId,
              source,
              succeeded,
              enabled,
            }),
          );
        }
      }
    }
  };

  const clearPrefetchHoverTimeout = useCallback(() => {
    if (!prefetchHoverTimeout.current) return;
    clearTimeout(prefetchHoverTimeout.current);
    prefetchHoverTimeout.current = null;
  }, []);

  const handleMouseEnter = (index: number) => {
    currentHoveredDiv.current = index;
    const hoveredRow = keyboardRows.find(
      (row) =>
        row.item.kind === "notification" &&
        row.item.notificationIndex === index,
    );
    if (hoveredRow) setActiveKeyboardRowKey(hoveredRow.key);
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

    void markNotificationSeen(Number.parseInt(notification.id), typedWrite).finally(() =>
      queryClient.invalidateQueries({ queryKey: cacheKey, exact: true }),
    );
  };

  const openTask = async (
    mode: string,
    notification: INotification | null = null,
    index?: number,
  ) => {
    const selectedInbox =
      selectedKeyboardRow?.item.kind === "notification"
        ? selectedKeyboardRow.item.notification
        : undefined;
    const clickTarget = notification ?? selectedInbox;
    if (!clickTarget) return;

    if (
      clickTarget.type === "Invited" &&
      clickTarget.notification_invite?.inviteURL
    ) {
      return router.push(clickTarget.notification_invite.inviteURL);
    }

    if (clickTarget.type === "AgentMessage" && clickTarget.fromAgentId) {
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
    const inboxFlowQuery = disableInboxFlow
      ? ""
      : queryParams
        ? `?${inboxConfig.urls.queryParams.inboxFlow}&${queryParams.slice(1)}`
        : `?${inboxConfig.urls.queryParams.inboxFlow}`;

    if (notification) {
      const decisionCommentId = decisionCommentLinks ? notification.decisionCommentId : undefined;
      const mentionedQueryParam =
        !decisionCommentId && notification.type === "Mentioned" && notification.commentId
          ? commentIdHash(notification.commentId)
          : "";
      return navigateToTask(
        notification.projectId,
        notification.task?.uniqueIndex,
        "push",
        withDecisionCommentAnchor(
          `${inboxFlowQuery}${mentionedQueryParam}`,
          notification.decisionCommentId,
          decisionCommentLinks,
        ),
        notification.task,
      );
    }

    if (!selectedInbox) return;
    const projectName = selectedInbox.project?.name;
    const taskIndex = selectedInbox.task?.uniqueIndex;
    const mentionedQueryParam =
      selectedInbox.type === "Mentioned" && selectedInbox.commentId
        ? commentIdHash(selectedInbox.commentId)
        : "";
    navigateToTask(
      selectedInbox.project?.id ?? selectedInbox.projectId,
      taskIndex,
      "push",
      withDecisionCommentAnchor(
        `${inboxFlowQuery}${mentionedQueryParam}`,
        selectedInbox.decisionCommentId,
        decisionCommentLinks,
      ),
      selectedInbox.task,
    );
  };

  const buildUniqueTasksPlaylist = (notifications: INotification[]) =>
    buildInboxTasksPlaylist(
      notifications,
      decisionCommentLinks,
      inboxVisibleOrder ? { oldestFirst: selectedSplit === "Blocked by you", snapshot } : undefined,
    );

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
    decisionCommentLinks,
    activeDrafts,
    keyboardRows,
    selectedKeyboardRow?.key,
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
        data-testid="inbox-list"
        hidden={inboxConfig.visibility.hidden(value, index)}
        style={{
          flex: 1,
          display: inboxConfig.visibility.display(value, index),
          width: "100%",
          flexDirection: "column",
          overflowY: "auto",
        }}
        className={cn(
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
              <div className="top-0 z-10 flex items-center py-2 text-icon-hover-gray backdrop-blur-sm">
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

              <div className="">
                {group.items.map((item) => {
                  if (item.kind === "draft") {
                    const rowKey = `draft-${item.draft.id}`;
                    return (
                      <div
                        id={`inbox-draft-${item.draft.id}`}
                        key={`${groupKey}-draft-${item.draft.id}`}
                      >
                        <InboxDraftRow
                          draft={item.draft}
                          activeDrafts={activeDrafts}
                          userId={currentUser!.id}
                          selected={selectedKeyboardRow?.key === rowKey}
                          onFocus={() => setActiveKeyboardRowKey(rowKey)}
                          onOpen={openDraft}
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
                    selectedKeyboardRow?.key ===
                    `notification-${notification.id}`;
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
                        displayAvatar={preferencesUpdatedAt === 0 && inboxDocument ? inboxDocument.data.displayAvatar : userPreferences?.displayAvatar}
                      >
                        <MaybeSwipeable
                          enabled={isMbl && !isWaitingOnSynthetic}
                          onArchive={() =>
                            void eHandler(false, globalIndex, "swipe")
                          }
                          onSnooze={() => setSnoozeTarget(notification)}
                        >
                          <div
                            className={cn(
                              "group/selection_row relative flex items-center gap-[8px] sm:p-inbox-horizontal md:gap-[0px] md:border-l-4 md:p-0",
                              {
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
                                onClickCapture={notification.type !== "Invited" ? (event) => {
                                  if (!event.currentTarget.contains(event.target as Node)) return;
                                  const control = (event.target as Element).closest("button, input, select, textarea, a");
                                  if (control && control !== event.currentTarget) return;
                                  event.stopPropagation();
                                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                                  event.preventDefault();
                                  void openTask("view", notification, globalIndex);
                                } : undefined}
                                onClick={() =>
                                  notification.type !== "Invited" &&
                                  setTasksPlayList(
                                    buildUniqueTasksPlaylist(_notifications),
                                  )
                                }
                                href={
                                  notification.type !== "Invited"
                                    ? withDecisionCommentAnchor(
                                        inboxConfig.urls.taskDetail(
                                          notification.projectId,
                                          notification.task?.uniqueIndex,
                                          `&split=${encodeURIComponent(selectedSplit)}${mentionedQueryParam}`,
                                        ),
                                        notification.decisionCommentId,
                                        decisionCommentLinks,
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
