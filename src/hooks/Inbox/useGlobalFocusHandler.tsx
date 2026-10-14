import { archiveNotifications, toggleNotificationArchive } from "@/lib/api/typedClient";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6979_TYPED_WRITES_FLAG } from "@/lib/flags/keys";
import {
  globalNotificationFocusAtom,
  currentUserAtom,
  inViewObjectAtom,
} from "@/store";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { useQueryClient } from "@tanstack/react-query";
import { INotification, TRemoveFromInboxMode } from "@/models/model";
import {
  scrollToCenterIfNearBottom,
  scrollToCenterIfNearTop,
} from "@/utils/helperFunctions/helperFunctions";
import { useUndoContext } from "../General/useUndo";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ReminderConditions } from "@prisma/client";
import axiosClient from "@/utils/axiosClient";
import { realtimeEchoHeaders } from "@/lib/realtime/client";
import { inboxConfig } from "@/lib/configs/inbox.config";
import { inboxDataQueryKey } from "./useGetNotifications";
import {
  LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT,
  LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT,
  type LearnTutorialInboxArchivedDetail,
} from "@/lib/tutorial/learnTutorialState";
import { updateInboxOptimistically } from "@/lib/inboxSync/optimistic";
import {
  createInboxRemovalMutation,
  findInboxRestoreAnchors,
} from "@/lib/inboxSync/mutation";
export interface INotificationsFromTQ {
  structuredData: {
    data: INotification[][];
    tabs: any;
  };
  notifications: INotification[];
  splitsNoImportant: import("@/lib/inboxSplitSettings").InboxSplitKey[];
  showImportantSplit: boolean;
}

interface IRemindBody {
  type: string;
  taskId: number | null;
  userId: number | undefined;
  projectId: number | null;
  remindAt: string | undefined;
  reminderOption: ReminderConditions;
  remindTask: boolean | undefined;
}

const isWaitingOnSynthetic = (notification: unknown) => {
  const row = notification as { waitingOnSynthetic?: boolean; id?: string };
  return row.waitingOnSynthetic === true || String(row.id).startsWith("-");
};

const useGlobalFocusHandler = (queryKey?: readonly unknown[]) => {
  const typedWrites = useFlag(HTPR_6979_TYPED_WRITES_FLAG);
  let typedArchive: typeof toggleNotificationArchive | undefined;
  let typedBulkArchive: typeof archiveNotifications | undefined;
  if (typedWrites) {
    typedArchive = toggleNotificationArchive;
    typedBulkArchive = archiveNotifications;
  }
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom,
  );

  const { performActionAndStoreUndoData } = useUndoContext();

  const currentUser = useRecoilValue(currentUserAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const router = useRouter();

  const queryClient = useQueryClient();
  const resolvedQueryKey = queryKey ?? inboxDataQueryKey(currentUser?.id);
  const reconcileInbox = () =>
    queryClient.invalidateQueries({ queryKey: resolvedQueryKey, exact: true });

  const archiveNotificationGetter = async (
    notification_reminder: INotification | IRemindBody,
    cmdControl: TRemoveFromInboxMode,
    undoHandler: any,
  ): Promise<boolean> => {
    if (isWaitingOnSynthetic(notification_reminder)) return false;

    if (cmdControl === "Remind") {
      removeElementFromState(notification_reminder, undoHandler, cmdControl);
      try {
        await axios.post("/api/queues/inboxReminder", notification_reminder);
      } finally {
        await reconcileInbox();
      }
      return true;
    } else {
      const tutorialArchive = searchParams?.get("tutorial") === "1";
      if (!tutorialArchive) {
        removeElementFromState(notification_reminder, undoHandler, cmdControl);
      }
      let persisted = false;
      try {
        persisted = await archiveHandler(
          notification_reminder,
          globalFocus.currIdx,
          cmdControl === "Task" ? "Task" : "Notification",
        );
      } catch {
        persisted = false;
      }
      const notificationId =
        "id" in notification_reminder
          ? Number(notification_reminder.id)
          : Number.NaN;
      if (!persisted) {
        if (
          tutorialArchive &&
          Number.isSafeInteger(notificationId) &&
          notificationId > 0 &&
          typeof notification_reminder.taskId === "number"
        ) {
          await queryClient.refetchQueries({ queryKey: resolvedQueryKey });
          const detail: LearnTutorialInboxArchivedDetail = {
            notificationId,
            taskId: notification_reminder.taskId,
            source: pathname?.startsWith("/detail") ? "detail" : "inbox",
          };
          window.dispatchEvent(
            new CustomEvent(LEARN_TUTORIAL_INBOX_ARCHIVE_FAILED_EVENT, {
              detail,
            }),
          );
        }
        await reconcileInbox();
        return false;
      }
      if (tutorialArchive) {
        removeElementFromState(notification_reminder, undoHandler, cmdControl);
      }
      if (
        Number.isSafeInteger(notificationId) &&
        notificationId > 0 &&
        typeof notification_reminder.taskId === "number"
      ) {
        const detail: LearnTutorialInboxArchivedDetail = {
          notificationId,
          taskId: notification_reminder.taskId,
          source: pathname?.startsWith("/detail") ? "detail" : "inbox",
        };
        window.dispatchEvent(
          new CustomEvent(LEARN_TUTORIAL_INBOX_ARCHIVED_EVENT, { detail }),
        );
      }
      await reconcileInbox();
      return true;
    }
  };

  const moveIdxUp = (currentSplitOverride?: INotification[]) => {
    let currentSplit = currentSplitOverride;
    if (!currentSplit) {
      let x: INotificationsFromTQ | undefined =
        queryClient.getQueryData(resolvedQueryKey);
      currentSplit = x?.structuredData.data[globalFocus.currSplit] ?? [];
    }
    const selectedNotification = currentSplit[globalFocus.currIdx];

    if (selectedNotification) {
      if (globalFocus.currIdx <= 0) {
      } else {
        setGlobalFocus((prev) => ({ ...prev, currIdx: prev.currIdx - 1 }));

        const activeElement = document.getElementById(
          `inbox-${selectedNotification.id}`,
        );
        activeElement && scrollToCenterIfNearTop(activeElement);
      }
    } else {
      if (currentSplit.length > 0) {
        setGlobalFocus((prev) => ({ ...prev, currIdx: 0 }));
        const lastEl = currentSplit[0];
        document
          .getElementById(`inbox-${lastEl.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const moveIdxDown = async (currentSplitOverride?: INotification[]) => {
    const _notifications: INotificationsFromTQ | undefined =
      queryClient.getQueryData(resolvedQueryKey);
    const currentSplit =
      currentSplitOverride ??
      _notifications?.structuredData?.data[globalFocus.currSplit];
    const selectedNotification = currentSplit?.[globalFocus.currIdx];
    console.log(
      "🚀 ~ moveIdxDown ~ selectedNotification:",
      selectedNotification,
    );
    if (!currentSplit) return;
    if (selectedNotification) {
      if (globalFocus.currIdx === currentSplit.length - 1) {
      } else {
        setGlobalFocus((prev) => ({ ...prev, currIdx: prev.currIdx + 1 }));
        const activeElement = document.getElementById(
          `inbox-${currentSplit[globalFocus.currIdx + 1]?.id}`,
        );
        activeElement && scrollToCenterIfNearBottom(activeElement);
      }
    } else {
      if (currentSplit.length > 0) {
        setGlobalFocus((prev) => ({ ...prev, currIdx: 0 }));
        document
          .getElementById(`inbox-${currentSplit[0].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const removeElementFromState = (
    elementToRemove: INotification | any,
    undoHandler: any,
    cmdControl: TRemoveFromInboxMode,
  ) => {
    console.time("StartingProcess");
    const _notifications: INotificationsFromTQ | undefined =
      queryClient.getQueryData(resolvedQueryKey);
    const cachePayload = _notifications?.notifications
      ? updateInboxOptimistically({
          queryClient,
          queryKey: resolvedQueryKey,
          accountId: currentUser.id,
          mutation: createInboxRemovalMutation([elementToRemove]),
        })
      : null;
    const restoreAnchors =
      _notifications && cachePayload
        ? findInboxRestoreAnchors(
            _notifications.notifications,
            cachePayload.notifications,
            String(elementToRemove.id),
          )
        : { beforeNotificationId: null, afterNotificationId: null };
    const body = {
      notification: elementToRemove,
      currentUser,
      queryKey: resolvedQueryKey,
      ...restoreAnchors,
    };
    undoHandler &&
      performActionAndStoreUndoData(
        body,
        "Undo remove notification",
        undoHandler,
      );
    if (!_notifications || !cachePayload) return;
    const prevTabLength = _notifications.structuredData.tabs.length;
    const currentSplitName =
      _notifications.structuredData.tabs[globalFocus.currSplit].project;
    const newState = cachePayload.notifications;
    console.timeEnd("StartingProcess");

    updateActiveSplitView(
      prevTabLength,
      currentSplitName,
      cachePayload,
      !!elementToRemove,
    );

    if (!pathname?.startsWith("/detail")) router.refresh();

    return newState;
  };

  const archiveHandler = async (
    notification: INotification | any,
    index: number,
    mode?: string,
  ) => {
    const tutorialArchive = searchParams?.get("tutorial") === "1";
    const notificationResponse = typedArchive ? await typedArchive({
      id: String(notification.id),
      taskId: notification.taskId,
      userId: currentUser.id,
      type: notification.type,
      ...(tutorialArchive ? { tutorial: 1 } : {}),
    }, realtimeEchoHeaders()) : await fetch(
      `/api/notifications/markAsDone?id=${notification.id}&taskId=${notification.taskId}&userId=${currentUser.id}&type=${notification.type}${tutorialArchive ? "&tutorial=1" : ""}`,
      {
        method: "GET",
        headers: realtimeEchoHeaders(),
      },
    );
    if (!notificationResponse.ok) return false;
    if (mode === "Task") {
      const taskResponse = await fetch(`/api/tasks/single`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTask: { id: notification.taskId, status: "Archive" },
        }),
      });
      if (!taskResponse.ok) return false;
    }
    return true;
  };

  const updateInView = async () => {
    const _notifications: INotificationsFromTQ | undefined =
      await queryClient.getQueryData(resolvedQueryKey);
    if (!_notifications) return;
    const { task } =
      _notifications?.structuredData.data[globalFocus.currSplit][
        globalFocus.currIdx
      ];
    setInViewObject({
      taskId: task.id,
      taskProjectId: task.projectId,
      sectionId: task.sectionId,
    });
  };

  const bulkArchiveNotifications = async (
    notifications: INotification[],
    mode: TRemoveFromInboxMode,
    undoHandler: any,
  ) => {
    const archivableNotifications = notifications.filter(
      (notification) => !isWaitingOnSynthetic(notification),
    );
    if (archivableNotifications.length === 0) return;

    const notificationIds = archivableNotifications.map((notification) => ({
      taskId: notification.taskId,
      userId: currentUser.id,
      notificationId: parseInt(notification.id),
    }));

    const bulkUndoData = {
      notifications: archivableNotifications,
      notificationIds,
      currentUser,
      isBulkOperation: true,
    };

    performActionAndStoreUndoData(
      bulkUndoData,
      `Undo archive (${archivableNotifications.length} items)`,
      undoHandler,
    );

    bulkRemoveElementsFromState(archivableNotifications);

    try {
      await bulkArchiveHandler(notificationIds, mode);
    } finally {
      await reconcileInbox();
    }
  };

  const bulkRemoveElementsFromState = (
    notificationsToRemove: INotification[],
  ) => {
    console.time("BulkRemoveProcess");

    const _notifications: INotificationsFromTQ | undefined =
      queryClient.getQueryData(resolvedQueryKey);
    const prevTabLength = _notifications?.structuredData.tabs.length;
    const currentSplitName =
      _notifications?.structuredData.tabs[globalFocus.currSplit].project;
    if (!_notifications || !_notifications.notifications) return;

    const cachePayload = updateInboxOptimistically({
      queryClient,
      queryKey: resolvedQueryKey,
      accountId: currentUser.id,
      mutation: createInboxRemovalMutation(notificationsToRemove),
    });
    if (!cachePayload) return;
    const newState = cachePayload.notifications;

    updateActiveSplitView(
      prevTabLength,
      currentSplitName,
      cachePayload,
      notificationsToRemove.length > 0,
    );

    router.refresh();
    console.timeEnd("BulkRemoveProcess");

    return newState;
  };

  const bulkArchiveHandler = async (
    notificationIds: Array<{
      taskId: number | null;
      userId: number;
      notificationId: number | null;
    }>,
    mode: string,
  ) => {
    const archivableIds = notificationIds.filter(
      (entry): entry is { taskId: number | null; userId: number; notificationId: number } =>
        typeof entry.notificationId === "number" && entry.notificationId > 0,
    );
    if (archivableIds.length === 0) return;

    typedBulkArchive ? await typedBulkArchive({
      notificationIds: archivableIds,
      status: "Archive",
    }, realtimeEchoHeaders()) : await axiosClient.post(
      "/notifications/(un)archiveBulk",
      {
        notificationIds: archivableIds,
        status: "Archive",
      },
      { headers: realtimeEchoHeaders() },
    );
  };

  const navigateTabs = (
    newValue: number,
    newNotifications: INotificationsFromTQ,
    options?: { preserveCurrIdx?: boolean },
  ) => {
    document.getElementById(`tab-${newValue}`)?.scrollIntoView({
      behavior: inboxConfig.scroll.desktopBehavior,
      inline: "center",
      block: "center",
    });

    const currentSplit =
      newNotifications?.structuredData?.data?.[newValue] ?? [];
    const newCurrIdx =
      options?.preserveCurrIdx && globalFocus.currSplit === newValue
        ? Math.min(globalFocus.currIdx, Math.max(0, currentSplit.length - 1))
        : 0;

    setGlobalFocus({ currSplit: newValue, currIdx: newCurrIdx });

    if (options?.preserveCurrIdx && currentSplit.length > 0) {
      const item = currentSplit[newCurrIdx];
      if (item) {
        setTimeout(() => {
          document
            .getElementById(`inbox-${item.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      }
    }

    const tab = newNotifications?.structuredData?.tabs?.[newValue];
    if (tab && pathname?.startsWith("/inbox")) {
      const isProjectSplit = tab?.projectId != null;
      const projectIdParam = isProjectSplit
        ? `&projectId=${tab.projectId}`
        : "";
      const tutorialParams =
        searchParams?.get("tutorial") === "1" ? "&tutorial=1" : "";
      router.replace(
        `/inbox?split=${encodeURIComponent(tab.project)}${projectIdParam}${tutorialParams}`,
      );
    }
  };

  const updateActiveSplitView = (
    prevTabLength: number,
    currentSplitName: string,
    newNotifications: INotificationsFromTQ | undefined,
    elementsExist: boolean,
  ) => {
    console.log(
      "🤔 ~ updateActiveSplitView ~ currentSplitName:",
      currentSplitName,
    );
    console.log("🤔 ~ updateActiveSplitView ~ prevTabLength:", prevTabLength);
    if (
      newNotifications &&
      elementsExist &&
      newNotifications?.structuredData?.data
    ) {
      let currentSplitIndex: number | undefined = undefined;
      try {
        if (newNotifications.structuredData.tabs.length <= prevTabLength) {
          try {
            const newCurrSplitIndex =
              newNotifications.structuredData.tabs.findIndex(
                (tab: { idx: number; project: string }) =>
                  tab.project === currentSplitName,
              );
            if (newCurrSplitIndex !== -1) {
              currentSplitIndex = newCurrSplitIndex;
              const isSameSplit = newCurrSplitIndex === globalFocus.currSplit;
              navigateTabs(newCurrSplitIndex, newNotifications, {
                preserveCurrIdx: isSameSplit,
              });
            }
          } catch (error) {
            console.log("🤔 ~ updateActiveSplitView ~ error:", error);
          }
        }
        const currentSplit =
          newNotifications?.structuredData?.data[
            currentSplitIndex ?? globalFocus.currSplit
          ];

        if (globalFocus.currIdx >= 0) {
          if (!currentSplit || currentSplit.length === 0) {
            let nextSplitWithData = -1;
            const totalSplits =
              newNotifications?.structuredData?.data.length || 0;

            for (let i = globalFocus.currSplit; i < totalSplits; i++) {
              if (
                newNotifications?.structuredData?.data[i] &&
                newNotifications?.structuredData?.data[i].length > 0
              ) {
                nextSplitWithData = i;
                break;
              }
            }

            if (nextSplitWithData === -1) {
              for (let i = globalFocus.currSplit - 1; i >= 0; i--) {
                if (
                  newNotifications?.structuredData?.data[i] &&
                  newNotifications?.structuredData?.data[i].length > 0
                ) {
                  nextSplitWithData = i;
                  break;
                }
              }
            }

            console.log(
              "🤔 ~ updateActiveSplitView ~ nextSplitWithData:",
              nextSplitWithData,
            );
            if (nextSplitWithData !== -1) {
              navigateTabs(nextSplitWithData, newNotifications);
            } else {
              navigateTabs(globalFocus.currSplit, newNotifications);
            }
          }

          else if (
            globalFocus.currIdx >= 0 &&
            globalFocus.currIdx < currentSplit.length - 1
          ) {
          } else if (globalFocus.currIdx === currentSplit.length - 1) {
            setGlobalFocus((prev) => ({
              ...prev,
              currIdx: Math.max(0, prev.currIdx - 1),
            }));
          }
        }
      } catch (error) {
        console.log("🤔 ~ updateActiveSplitView ~ error:", error);
      }
    }
  };

  return {
    archiveNotificationGetter,
    moveIdxDown,
    moveIdxUp,
    bulkArchiveNotifications,
    bulkArchiveHandler,
  };
};

export default useGlobalFocusHandler;
