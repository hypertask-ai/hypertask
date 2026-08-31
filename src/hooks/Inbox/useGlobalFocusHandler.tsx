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
  findInboxRestoreIndex,
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
  ) => {
    if (isWaitingOnSynthetic(notification_reminder)) return;

    if (cmdControl === "Remind") {
      removeElementFromState(notification_reminder, undoHandler, cmdControl);
      try {
        await axios.post("/api/queues/inboxReminder", notification_reminder);
      } finally {
        await reconcileInbox();
      }
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
        return;
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
    }
  };

  // =============== up handler
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
        // setSelectedInbox(_notifications[inboxTaskIndex - 1])
        // document.getElementById(`inbox-${_notifications[_notifications.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        setGlobalFocus((prev) => ({ ...prev, currIdx: prev.currIdx - 1 }));
        // setSelectedInbox(_notifications[indexToGoTo])

        const activeElement = document.getElementById(
          `inbox-${selectedNotification.id}`,
        ); //?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        activeElement && scrollToCenterIfNearTop(activeElement);
      }
    } else {
      if (currentSplit.length > 0) {
        setGlobalFocus((prev) => ({ ...prev, currIdx: 0 }));
        // setSelectedInbox(_notifications[_notifications.length - 1])
        const lastEl = currentSplit[0];
        document
          .getElementById(`inbox-${lastEl.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // ============== down handler
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
      // const index = _notifications.findIndex((notification)=>notification.id===_notifications[inboxTaskIndex].id)
      // const indexToGoTo=index + 1
      // console.log("🚀 ~ file: index.tsx:103 ~ handleKeyDown ~ index:", index)
      if (globalFocus.currIdx === currentSplit.length - 1) {
        // inboxTaskIndex&&setSelectedInbox(__notifications[inboxTaskIndex])
        // document.getElementById(`inbox-${_notifications[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        setGlobalFocus((prev) => ({ ...prev, currIdx: prev.currIdx + 1 }));
        const activeElement = document.getElementById(
          `inbox-${currentSplit[globalFocus.currIdx + 1]?.id}`,
        ); //?.scrollIntoView({ behavior: 'smooth', inline: "nearest"  })
        activeElement && scrollToCenterIfNearBottom(activeElement);
        // document.getElementById(`inbox-${_notifications[index + 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } else {
      if (currentSplit.length > 0) {
        // setSelectedInbox(_notifications[0])
        setGlobalFocus((prev) => ({ ...prev, currIdx: 0 }));
        document
          .getElementById(`inbox-${currentSplit[0].id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // ================== REMOVE element from subarrays of notification
  //This function is updating the notification list from the cache. This is whats displayed in the inbox comp
  const removeElementFromState = (
    elementToRemove: INotification | any,
    undoHandler: any,
    cmdControl: TRemoveFromInboxMode,
  ) => {
    console.time("StartingProcess");
    const _notifications: INotificationsFromTQ | undefined =
      queryClient.getQueryData(resolvedQueryKey);
    if (!_notifications?.notifications) return;
    const prevTabLength = _notifications.structuredData.tabs.length;
    const currentSplitName =
      _notifications.structuredData.tabs[globalFocus.currSplit].project;
    const cachePayload = updateInboxOptimistically({
      queryClient,
      queryKey: resolvedQueryKey,
      accountId: currentUser.id,
      mutation: createInboxRemovalMutation([elementToRemove]),
    });
    if (!cachePayload) return;
    const body = {
      notification: elementToRemove,
      currentUser,
      notificationIndex: findInboxRestoreIndex(
        _notifications.notifications,
        cachePayload.notifications,
        String(elementToRemove.id),
      ),
    };
    undoHandler &&
      performActionAndStoreUndoData(
        body,
        "Undo remove notification",
        undoHandler,
      );
    const newState = cachePayload.notifications;
    console.timeEnd("StartingProcess");

    //Update split moved within removeElementFromState
    updateActiveSplitView(
      prevTabLength,
      currentSplitName,
      cachePayload,
      !!elementToRemove,
    );

    // On /detail pages an archive/snooze queues router.replace to the next
    // task; a refresh here races that replace and can restore the old URL,
    // parking the user on the snoozed task (HTPR-4234/HTPR-4570). The inbox
    // list is client-cache driven (updated above), so only refresh off-detail.
    if (!pathname?.startsWith("/detail")) router.refresh();

    return newState;
  };

  //After removing the notification from archive, this sets the check for notification as archived in the backend
  const archiveHandler = async (
    notification: INotification | any,
    index: number,
    mode?: string,
  ) => {
    const tutorialArchive = searchParams?.get("tutorial") === "1";
    const notificationResponse = await fetch(
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

  // update InView
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

    // Prepare bulk data for API
    const notificationIds = archivableNotifications.map((notification) => ({
      taskId: notification.taskId,
      userId: currentUser.id,
      notificationId: parseInt(notification.id),
    }));

    // Store undo data for bulk operation
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

    // Remove all notifications from UI state
    bulkRemoveElementsFromState(archivableNotifications);

    // The server-confirmed refetch is the only path that persists IndexedDB.
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
      ({ notificationId }) =>
        typeof notificationId === "number" && notificationId > 0,
    );
    if (archivableIds.length === 0) return;

    // Bulk archive API call
    await axiosClient.post(
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

    // Scroll the inbox item at newCurrIdx into view when preserving index
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

  /**
 *Keeps track of active split. If there arent any notifications in the active split
 then just move to the next split if any. If there are notifications in the split, then stay there even if order of splits change when 
 getting from getInboxTabs
 *
 * @param {number} prevTabLength
 * @param {string} currentSplitName
 * @param {(INotificationsFromTQ | undefined)} newNotifications
 * @param {boolean} elementsExist
 */
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
          //we need to find the new global currSplit for the new tabs that we get.
          try {
            const newCurrSplitIndex =
              newNotifications.structuredData.tabs.findIndex(
                (tab: { idx: number; project: string }) =>
                  tab.project === currentSplitName,
              );
            if (newCurrSplitIndex !== -1) {
              currentSplitIndex = newCurrSplitIndex;
              // When staying on same split after archiving, preserve focus index
              // so focus doesn't jump to first element (HTPR-3650)
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
          // ======= if the current split's length is now 0, find next available split or stay on current split
          if (!currentSplit || currentSplit.length === 0) {
            // Try to find the next split with notifications, starting from current split
            let nextSplitWithData = -1;
            const totalSplits =
              newNotifications?.structuredData?.data.length || 0;

            // First, try to find a split with data starting from current split
            for (let i = globalFocus.currSplit; i < totalSplits; i++) {
              if (
                newNotifications?.structuredData?.data[i] &&
                newNotifications?.structuredData?.data[i].length > 0
              ) {
                nextSplitWithData = i;
                break;
              }
            }

            // If no split found forward, try backward from current split
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
              // All splits are empty, stay on current split with index 0
              navigateTabs(globalFocus.currSplit, newNotifications);
            }
          }

          // ======= if there's still elements left, continue as usual :)
          else if (
            globalFocus.currIdx >= 0 &&
            globalFocus.currIdx < currentSplit.length - 1
          ) {
            //Do nothing here
          } else if (globalFocus.currIdx === currentSplit.length - 1) {
            // If we were on the last item, move to the previous item in the same split
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
