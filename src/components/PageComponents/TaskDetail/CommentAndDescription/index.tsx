"use client";
import { useFlag } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_6899_STABLE_LAYOUT_FLAG, HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG } from "@/lib/flags/keys";
import { useThreadSettled } from "@/hooks/Task Detail/useThreadSettled";
import React, { Suspense, useEffect, useMemo } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import dynamic from "next/dynamic";
import DescriptionContainer from "./DescriptionContainer";
import DescriptionTopRow from "./DescriptionContainer/TopRow/DescriptionTopRow";
const DescriptionReactions = dynamic(
  () => import("./DescriptionContainer/BottomRow/DescriptionReactions")
);
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import UploadingDescriptionContainer from "./UploadingDescription/UploadingDescriptionContainer";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import DescriptionSubTask from "./DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks";
import DescriptionPages from "./DescriptionContainer/DescriptionSubTasks/DescriptionPages";
import { TaskPagesProvider } from "./DescriptionContainer/DescriptionSubTasks/TaskPagesContext";
import { IUploadingDescription } from "@/models/model";
import { CommentsProvider } from "@/lib/contexts/CommentsContext";
import CommentsContainer from "./CommentContainer/CommentsContainer";
import UploadingCommentsContainer from "./UploadingComment/UploadingCommentContainer";
import { SettledComposerSlot } from "./SettledComposerSlot";
import NewCommentComponent from "./CommentContainer/NewCommentComponent";
import DescriptonBody from "./DescriptionContainer/DescriptonBody";
import { StaticDescriptionFrame } from "./DescriptionContainer/StaticDescriptionShell";
import { linkifyHtml } from "@/utils/helperFunctions/linkifyHtml";
import TaskInfo, { ITaskInfoContainer, TaskInfoLateDetails } from "../TaskInfoColumn/TaskInfo";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import BaseCommentAndDescriptionContainer from "./BaseCommentAndDescriptionContainer";
import RichTextPersonHovercards from "@/components/Common/RichTextPersonHovercards";
import AgentRunActivityRow from "./AgentRunActivityRow";
import { TicketChatSessionsReminder } from "./TicketChatSessionsReminder";
import { HTPR_7318_TICKET_CHAT_REMINDER_FLAG } from "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder";

const CommentAndDescriptionContainer = (props: ITaskInfoContainer) => {
  const {
    dynamicTopValue,
    showAssignModal,
    slugs,
    _parsedTask,
    sectionsForProjectTQ,
    toggleDueDate,
    toggleEstimateModal,
    toggleLabelModal,
    toggleMoveModal,
    toggleMoveToBoardModal,
    togglePriorityModal,
    estimate_,
    priority_,
    labelsFromTQ,
    moveTaskToNextColumn,
    removeRelationHandler,
    toggleModal,
    followers,
    updateWaitingOn,
    updateCycle,
  } = props;
  const _mbl = useContext(MobileViewContext);
  const { uploadingDescription, comments, stacked } =
    useDescriptionAndCommentsContext();
  const stableLayout = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const {
    currentTask,
    secondaryPanelsReady,
    cachedLayout,
    hasDraft,
    virtualizer,
    uploadingComments,
    listRef,
    virtualizeIndexes,
    showScrollToTop,
    draftsFromTQ,
    agentRunActivities,
    visibleFeedItems,
    allowPerks,
    descriptionStart,
    liveRowsPendingFor,
    newCommentsSnapshotReady,
    showLiveRows,
  } = useTaskContext();
  const descriptionFirstFlag = useFlag(HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG);
  const ticketChatReminder = useFlag(HTPR_7318_TICKET_CHAT_REMINDER_FLAG);
  const ticketChatSessionsReminder = ticketChatReminder ? (
    secondaryPanelsReady !== false && currentTask ? <TicketChatSessionsReminder taskId={currentTask.id} /> : null
  ) : null;
  const serverRowsShown = liveRowsPendingFor(descriptionFirstFlag || descriptionStart === "server");

  const {
    taskInfoVirtualIndex,
    descriptionVirtualIndex,
    descriptionBottomVirtualIndex,
    commentsStartVirtualIndex,
    uploadingCommentsStartVirtualIndex,
    numberOfComments,
    numberOfUploadingComments,
  } = virtualizeIndexes;

  const hydrated = useHydrated();
  const liveRowsShown = hydrated && !serverRowsShown;
  useEffect(() => {
    if (serverRowsShown) showLiveRows();
  }, [serverRowsShown, showLiveRows]);
  const descriptionAuthor: DescriptionAuthor = {
    name: currentTask?.agent?.displayName ?? currentTask?.user?.displayName ?? "",
    pfp: currentTask?.agent?.photoURL ?? currentTask?.user?.photoURL ?? "",
    projectId: currentTask?.projectId,
    subject: currentTask?.agent
      ? { kind: "agent", id: currentTask.agent.id }
      : currentTask?.user
        ? { kind: "user", id: currentTask.user.id }
        : null,
  };
  const descriptionRow = { index: descriptionVirtualIndex, key: "description", start: 0 };
  const serverRenderedRows = taskInfoVirtualIndex >= 0
    ? [{ index: taskInfoVirtualIndex, key: "task-info", start: 0 }, descriptionRow]
    : [descriptionRow];
  const measuredItems = liveRowsShown ? virtualizer.getVirtualItems() : [];
  const virtualItems = serverRowsShown
    ? serverRenderedRows
    : liveRowsShown && !_mbl && !measuredItems.some((item) => item.index === descriptionVirtualIndex)
      ? [descriptionRow, ...measuredItems]
      : measuredItems;
  const rowStaysInFlow = (index: number) =>
    (!_mbl && index === descriptionVirtualIndex) || (cachedLayout && index <= descriptionBottomVirtualIndex);
  const rowPlacement = (index: number, start: number): React.CSSProperties => {
    if (rowStaysInFlow(index)) return { position: "relative" };
    if (serverRowsShown) return { position: "relative", display: "flow-root" };
    return { position: "absolute", transform: `translateY(${start}px)` };
  };
  const { settled: threadSettled, slotRef: composerSlotRef } = useThreadSettled(!cachedLayout && !_mbl, !serverRowsShown);


  const content = (
    <BaseCommentAndDescriptionContainer 
    ref={listRef}
    showScrollToTop={showScrollToTop}
    className={_mbl ? taskDetailSpacing.mobile.descriptionContainer : ""}
    >
      <RichTextPersonHovercards projectId={allowPerks ? currentTask?.projectId : undefined} />
      <div
        data-ticket-initial-scroll-ready={newCommentsSnapshotReady && !serverRowsShown}
        style={{
          height: _mbl && (!cachedLayout || numberOfComments || numberOfUploadingComments) ? `${virtualizer.getTotalSize()}px` : undefined,
          ...(stableLayout && cachedLayout && _mbl ? {
            minHeight: `max(100svh, ${numberOfComments || numberOfUploadingComments ? virtualizer.getTotalSize() : 0}px)`,
          } : {
            minHeight: !_mbl && (!cachedLayout || numberOfComments || numberOfUploadingComments) ? `${virtualizer.getTotalSize()}px` : undefined,
          }),
          position: "relative",
          width: "100%",
          zIndex: 1,
        }}
      >
        {virtualItems.map((vItem: { index: any; key: React.Key | null | undefined; start: any; }) => {
          let contentToRender = null;
          const currentItemIndex = vItem.index;

          if (currentItemIndex === taskInfoVirtualIndex && _mbl && (cachedLayout || secondaryPanelsReady !== false)) {
            contentToRender = (
              <TaskInfo
                showAssignModal={showAssignModal}
                toggleModal={toggleModal}
                slugs={slugs}
                _parsedTask={_parsedTask}
                currentTask={currentTask!}
                estimate_={estimate_}
                priority_={priority_}
                labelsFromTQ={labelsFromTQ}
                removeRelationHandler={removeRelationHandler}
                toggleDueDate={toggleDueDate}
                toggleEstimateModal={toggleEstimateModal}
                toggleLabelModal={toggleLabelModal}
                toggleMoveModal={toggleMoveModal}
                toggleMoveToBoardModal={toggleMoveToBoardModal}
                togglePriorityModal={togglePriorityModal}
                dynamicTopValue={dynamicTopValue}
                sectionsForProjectTQ={sectionsForProjectTQ}
                moveTaskToNextColumn={moveTaskToNextColumn}
                followers={followers}
                updateWaitingOn={updateWaitingOn}
                updateCycle={updateCycle}
              />
            );
          } else if (currentItemIndex === descriptionVirtualIndex) {
            contentToRender = serverRowsShown ? (
              <ServerRenderedDescription {...descriptionAuthor} />
            ) : (
              <Description
                {...descriptionAuthor}
                isUploadingDescription={uploadingDescription}
                hasDraft={hasDraft}
                draftsFromTQ={draftsFromTQ}
              />
            );
          } else if (currentItemIndex === descriptionBottomVirtualIndex) {
            contentToRender = (
              <>
                <div id="bottom-description" className="h-0" />
                {ticketChatSessionsReminder}
              </>
            );
          } else if (
            currentItemIndex >= commentsStartVirtualIndex &&
            currentItemIndex < commentsStartVirtualIndex + numberOfComments
          ) {
            const visiblePosition = currentItemIndex - commentsStartVirtualIndex;
            const feedItem = visibleFeedItems[visiblePosition];
            if (feedItem?.kind === "comment") {
              const commentIndex = feedItem.commentIndex;
              const comment = comments[commentIndex];
              if (comment) {
                contentToRender = (
                  <CommentsProvider
                    comment={comment}
                    i={commentIndex}
                    isStacked={stacked[commentIndex]}
                  >
                    <Suspense fallback={null}><CommentsContainer /></Suspense>
                  </CommentsProvider>
                );
              }
            } else if (feedItem?.kind === "agent-activity") {
              const activity = agentRunActivities[feedItem.activityIndex];
              if (activity && activity.type !== "response" && currentTask) {
                contentToRender = (
                  <AgentRunActivityRow activity={activity} taskId={currentTask.id} />
                );
              }
            }
          } else if (
            currentItemIndex >= uploadingCommentsStartVirtualIndex &&
            currentItemIndex <
              uploadingCommentsStartVirtualIndex + numberOfUploadingComments
          ) {
            const uploadingCommentIndex =
              currentItemIndex - uploadingCommentsStartVirtualIndex;
            const uploadingComment = uploadingComments[uploadingCommentIndex];
            if (uploadingComment) {
              contentToRender = (
                <UploadingCommentsContainer index={uploadingCommentIndex} />
              );
            }
          }

          if (!contentToRender) {
            return null;
          }

          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                ...rowPlacement(currentItemIndex, vItem.start),
                top: 0,
                left: 0,
                width: "100%",
                zIndex: 2000 - vItem.index,
              }}
            >
              {contentToRender}
            </div>
          );
        })}
      </div>
      {!cachedLayout && !_mbl && secondaryPanelsReady !== false && (
        <SettledComposerSlot settled={threadSettled} slotRef={composerSlotRef}><Suspense fallback={null}><NewCommentComponent /></Suspense></SettledComposerSlot>
      )}
      {cachedLayout && !_mbl && (stableLayout ? (
        <div data-task-composer-slot className="flow-root min-h-[168px]">
          {secondaryPanelsReady !== false && <Suspense fallback={null}><NewCommentComponent /></Suspense>}
        </div>
      ) : secondaryPanelsReady !== false && <Suspense fallback={null}><NewCommentComponent /></Suspense>)}
      {cachedLayout && !uploadingDescription && !hasDraft && <DescriptionPages />}
      {cachedLayout && _mbl && currentTask && (
        <TaskInfoLateDetails currentTask={currentTask} removeRelationHandler={removeRelationHandler} />
      )}
      {!_mbl && (
        <div aria-hidden className="shrink-0 @sm:h-6 @lg:h-16 @xl:h-48" />
      )}
    </BaseCommentAndDescriptionContainer>
  );
  return cachedLayout ? <TaskPagesProvider>{content}</TaskPagesProvider> : content;
};

type DescriptionAuthor = {
  name: string;
  pfp: string;
  projectId?: number;
  subject: import("@/models/personHovercard").PersonHovercardSubject | null;
};

const ServerRenderedDescription = (author: DescriptionAuthor) => {
  const isMbl = useContext(MobileViewContext);
  const { description } = useDescriptionAndCommentsContext();
  const html = useMemo(() => (description ? linkifyHtml(description) : ""), [description]);
  return (
    <DescriptionContainer>
      <DescriptionTopRow {...author} />
      <StaticDescriptionFrame html={html} isMbl={!!isMbl} />
    </DescriptionContainer>
  );
};

const Description = ({
  name,
  pfp,
  isUploadingDescription,
  draftsFromTQ,
  hasDraft,
  projectId,
  subject,
}: {
  name: string;
  pfp: string;
  isUploadingDescription: IUploadingDescription | undefined;
  draftsFromTQ: any;
  hasDraft: boolean;
  projectId?: number;
  subject: import("@/models/personHovercard").PersonHovercardSubject | null;
}) => {
  const stableLayout = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const { cachedLayout } = useTaskContext();
  return (
    <>
      <DescriptionContainer>
        <DescriptionTopRow
          name={name}
          pfp={pfp}
          projectId={projectId}
          subject={subject}
          isUploadingDescription={isUploadingDescription}
        />
        <DescriptonBody draftTQ={draftsFromTQ} />
        {isUploadingDescription && <UploadingDescriptionContainer />}
        {cachedLayout && stableLayout ? (
          <div data-task-reactions-slot className="flow-root min-h-[38px]">
            <Suspense fallback={null}><DescriptionReactions /></Suspense>
          </div>
        ) : <Suspense fallback={null}><DescriptionReactions /></Suspense>}
        {isUploadingDescription || hasDraft ? null : cachedLayout ? (
          <DescriptionSubTask />
        ) : (
          <TaskPagesProvider>
            <DescriptionSubTask />
            <DescriptionPages />
          </TaskPagesProvider>
        )}
      </DescriptionContainer>
    </>
  );
};

export default CommentAndDescriptionContainer;
