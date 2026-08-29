"use client";

import dynamic from "next/dynamic";
import axios from "axios";
import toast from "react-hot-toast";
import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";
import { globalNotificationFocusAtom } from "@/store";
import {
  IUserDraft,
  USER_DRAFTS_QUERY_KEY,
  useGetUserDrafts,
} from "@/hooks/General/useGetUserDrafts";
import { INotification, IUser, TRemoveFromInboxMode } from "@/models/model";
import { BulkSelectionProvider } from "@/lib/contexts/Inbox/BulkSelectionContext";
import { InboxZeroProvider } from "@/lib/contexts/InboxZeroContext";
import SplitTitle from "@/components/notifications/inboxSplit/SplitTitle";
import {
  InboxStructuredDataExpanded,
  InboxTabMeta,
} from "@/utils/helperFunctions/helperFunctions";
import { inboxConfig } from "@/lib/configs/inbox.config";

const InboxSplit = dynamic(
  () => import("@/components/notifications/inboxSplit"),
  { ssr: false }
);

const DRAFTS_INBOX_QUERY_KEY = ["drafts-inbox"] as const;

const Drafts = ({ currentUser }: { currentUser: IUser }) => {
  const queryClient = useQueryClient();
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom
  );
  const { drafts } = useGetUserDrafts(currentUser.id);
  const archivingDraftId = useRef<number | null>(null);

  const activeDrafts = useMemo(
    () => drafts.filter((draft) => draft.saved !== true),
    [drafts]
  );

  const notifications = useMemo(
    () =>
      activeDrafts.map((draft) => draftToNotification(draft, currentUser)),
    [activeDrafts, currentUser]
  );

  const draftsInboxPayload = useMemo(() => {
    const structuredData = buildDraftStructuredData(notifications);

    return {
      structuredData,
      notifications,
    };
  }, [notifications]);

  useEffect(() => {
    queryClient.setQueryData(DRAFTS_INBOX_QUERY_KEY, draftsInboxPayload);
    setGlobalFocus((prev) => ({
      currSplit: Math.max(
        0,
        Math.min(
          prev.currSplit,
          Math.max(0, draftsInboxPayload.structuredData.data.length - 1)
        )
      ),
      currIdx: clampFocusIndex(prev, draftsInboxPayload.structuredData.data),
    }));
  }, [draftsInboxPayload, queryClient, setGlobalFocus]);

  const activeSplitIndex = Math.max(
    0,
    Math.min(
      globalFocus.currSplit,
      Math.max(0, draftsInboxPayload.structuredData.data.length - 1)
    )
  );
  const activeNotifications =
    draftsInboxPayload.structuredData.data[activeSplitIndex] ?? [];
  const selectedNotification = activeNotifications[globalFocus.currIdx];

  const navigateTabs = useCallback(
    (newValue: number) => {
      document.getElementById(`tab-${newValue}`)?.scrollIntoView({
        behavior: inboxConfig.scroll.desktopBehavior,
        inline: "center",
        block: "center",
      });

      setGlobalFocus({ currSplit: newValue, currIdx: 0 });
    },
    [setGlobalFocus]
  );

  const archiveDraft = useCallback(
    async (
      notification: INotification,
      _index: number,
      _mode: TRemoveFromInboxMode
    ) => {
      const draftId = Number(notification.id);
      if (!Number.isInteger(draftId) || archivingDraftId.current !== null) {
        return;
      }

      const queryKey = USER_DRAFTS_QUERY_KEY(currentUser.id);
      archivingDraftId.current = draftId;

      try {
        await queryClient.cancelQueries({ queryKey, exact: true });
        const previousDrafts =
          queryClient.getQueryData<IUserDraft[]>(queryKey) ?? drafts;
        const previousDraft = previousDrafts.find(
          (draft) => draft.id === draftId && draft.saved !== true
        );
        if (!previousDraft) return;

        queryClient.setQueryData<IUserDraft[]>(
          queryKey,
          previousDrafts.map((draft) =>
            draft.id === draftId ? { ...draft, saved: true } : draft
          )
        );

        try {
          await axios.post("/api/drafts/archiveDraft", { draftId });
        } catch {
          queryClient.setQueryData<IUserDraft[]>(
            queryKey,
            (currentDrafts = []) =>
              currentDrafts.map((draft) =>
                draft.id === draftId ? previousDraft : draft
              )
          );
          toast.error("Draft wasn’t archived. Try again.");
          await queryClient
            .invalidateQueries({ queryKey, exact: true })
            .catch(() => undefined);
          return;
        }

        await queryClient
          .invalidateQueries({ queryKey, exact: true })
          .catch(() => undefined);
      } finally {
        if (archivingDraftId.current === draftId) {
          archivingDraftId.current = null;
        }
      }
    },
    [currentUser.id, drafts, queryClient]
  );

  const noopStarTask = async (_notification: INotification) => {};

  return (
    <InboxZeroProvider>
      <BulkSelectionProvider handleBulkArchive={async () => {}} allItems={[]}>
        <div className="flex items-center justify-center flex-col w-full min-h-screen bg-taskDetailPage">
          <div className="search_inbox_container min-h-screen inbox_tag_mobile_view pb-9 flex flex-col items-start bg-containerBackground">
            {notifications.length === 0 ? (
              <div className="responsive-inbox-padding-date-groups pt-12 text-text-light-gray text-content">
                No drafts
              </div>
            ) : (
              <>
                <DraftSplitTitlesContainer>
                  {draftsInboxPayload.structuredData.tabs.map((tab, index) => (
                    <SplitTitle
                      isSelected={activeSplitIndex !== index}
                      onClick={() => navigateTabs(index)}
                      key={`${tab.projectId ?? "all"}-${tab.project}`}
                      tab={tab}
                      showUnseenIndicator={false}
                    />
                  ))}
                </DraftSplitTitlesContainer>

                {draftsInboxPayload.structuredData.data.map(
                  (tabNotifications, index) => (
                    <InboxSplit
                      key={`draft-split-${index}-${activeSplitIndex}`}
                      updateNotification={() => {}}
                      onLoadCallback={() => {}}
                      selectedReset={selectedNotification}
                      originProject=""
                      value={activeSplitIndex}
                      index={index}
                      selectedSplit={
                        draftsInboxPayload.structuredData.tabs[activeSplitIndex]
                          ?.project ?? ""
                      }
                      _notifications={tabNotifications}
                      initialFocus={0}
                      markAsDone={archiveDraft}
                      starTaskUpdateInCache={noopStarTask}
                      disableRowButtons={true}
                      disableBulkActions={true}
                      disableNotificationSideEffects={true}
                      disableInboxFlow={true}
                      queryKey={DRAFTS_INBOX_QUERY_KEY}
                    />
                  )
                )}

                <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none @md:gap-8 w-100 bg-hoverCardBackground h-20 @md:h-8 inbox_title">
                  {draftsInboxPayload.structuredData.tabs.map((tab, index) => (
                    <SplitTitle
                      isSelected={activeSplitIndex !== index}
                      onClick={() => navigateTabs(index)}
                      key={`mobile-${tab.projectId ?? "all"}-${tab.project}`}
                      tab={tab}
                      showUnseenIndicator={false}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </BulkSelectionProvider>
    </InboxZeroProvider>
  );
};

const DraftSplitTitlesContainer = ({ children }: { children: ReactNode }) => (
  <div className="hidden items-baseline pl-[16px] pr-[16px] pt-9 responsive-inbox-padding @md:flex @md:gap-[9px] w-100 h-full inbox_title overflow-x-auto scrollbar-none no-scrollbar">
    <div className="flex group relative items-center flex-wrap grow gap-[9px] sm:pl-6">
      {children}
    </div>
  </div>
);

const buildDraftStructuredData = (
  notifications: INotification[]
): InboxStructuredDataExpanded => {
  const projectGroups = new Map<
    number,
    { label: string; notifications: INotification[] }
  >();

  notifications.forEach((notification) => {
    const projectId = notification.task?.projectId ?? notification.projectId;
    if (projectId == null) return;

    const existing = projectGroups.get(projectId);
    if (existing) {
      existing.notifications.push(notification);
      return;
    }

    projectGroups.set(projectId, {
      label: getDraftProjectLabel(notification),
      notifications: [notification],
    });
  });

  const projectSplits = Array.from(projectGroups.entries())
    .map(([projectId, group]) => ({
      projectId,
      label: group.label,
      notifications: group.notifications,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const allTab: InboxTabMeta = {
    idx: 0,
    project: "All",
    length: notifications.length,
    hasUnseen: false,
    projectId: null,
  };

  const projectTabs = projectSplits.map<InboxTabMeta>((split, index) => ({
    idx: index + 1,
    project: split.label,
    length: split.notifications.length,
    hasUnseen: false,
    projectId: split.projectId,
  }));

  return {
    tabs: [allTab, ...projectTabs],
    data: [notifications, ...projectSplits.map((split) => split.notifications)],
  };
};

const getDraftProjectLabel = (notification: INotification) => {
  const label =
    notification.project?.title ??
    notification.project?.name ??
    notification.task?.project?.title ??
    notification.task?.project?.name ??
    "Project";

  return label.trim() || "Project";
};

const clampFocusIndex = (
  prev: { currSplit: number; currIdx: number },
  data: INotification[][]
) => {
  const currSplit = Math.max(
    0,
    Math.min(prev.currSplit, Math.max(0, data.length - 1))
  );
  const splitLength = data[currSplit]?.length ?? 0;

  if (splitLength === 0) return 0;
  return Math.min(prev.currIdx, splitLength - 1);
};

const draftToNotification = (
  draft: IUserDraft,
  currentUser: IUser
): INotification => {
  const project = draft.task.project
    ? {
        id: draft.task.project.id,
        title: draft.task.project.title ?? draft.task.project.name ?? "Project",
        name: draft.task.project.name ?? draft.task.project.title ?? "Project",
      }
    : undefined;

  return {
    id: String(draft.id),
    type: "Comment" as INotification["type"],
    comment: { text: draft.content },
    status: "Normal",
    seen: true,
    userId: currentUser.id,
    user: currentUser,
    createdAt: draft.updatedAt
      ? new Date(draft.updatedAt).toISOString()
      : new Date().toISOString(),
    task: {
      ...draft.task,
      project,
    },
    taskId: draft.taskId,
    project,
    projectId: draft.task.projectId,
    fromUserId: currentUser.id,
    fromUser: {
      ...currentUser,
      displayName: "",
      photoURL: "",
    },
  } as INotification;
};

export default Drafts;
