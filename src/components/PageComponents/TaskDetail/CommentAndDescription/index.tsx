"use client";
import React from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import dynamic from "next/dynamic";
import DescriptionContainer from "./DescriptionContainer";
import DescriptionTopRow from "./DescriptionContainer/TopRow/DescriptionTopRow";
// import DescriptionReactions from "./DescriptionContainer/BottomRow/DescriptionReactions";
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
import NewCommentComponent from "./CommentContainer/NewCommentComponent";
import DescriptonBody from "./DescriptionContainer/DescriptonBody";
import TaskInfo, { ITaskInfoContainer } from "../TaskInfoColumn/TaskInfo";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import BaseCommentAndDescriptionContainer from "./BaseCommentAndDescriptionContainer";
import RichTextPersonHovercards from "@/components/Common/RichTextPersonHovercards";
import AgentRunActivityRow from "./AgentRunActivityRow";

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
  const {
    currentTask,
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
  } = useTaskContext();

  const {
    taskInfoVirtualIndex,
    descriptionVirtualIndex,
    descriptionBottomVirtualIndex,
    commentsStartVirtualIndex,
    uploadingCommentsStartVirtualIndex,
    numberOfComments,
    numberOfUploadingComments,
  } = virtualizeIndexes;

  // ------------------------------------------------------------------

  return (
    <BaseCommentAndDescriptionContainer 
    ref={listRef}
    showScrollToTop={showScrollToTop}
    className={_mbl ? taskDetailSpacing.mobile.descriptionContainer : ""}
    >
      <RichTextPersonHovercards projectId={allowPerks ? currentTask?.projectId : undefined} />
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
          zIndex: 1,
        }}
      >
        {virtualizer.getVirtualItems().map((vItem: { index: any; key: React.Key | null | undefined; start: any; }) => {
          let contentToRender = null;
          const currentItemIndex = vItem.index;

          if (currentItemIndex === taskInfoVirtualIndex && _mbl) {
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
            contentToRender = (
              <Description
                name={currentTask?.agent?.displayName ?? currentTask?.user?.displayName ?? ""}
                pfp={currentTask?.agent?.photoURL ?? currentTask?.user?.photoURL ?? ""}
                projectId={currentTask?.projectId}
                subject={currentTask?.agent
                  ? { kind: "agent", id: currentTask.agent.id }
                  : currentTask?.user
                    ? { kind: "user", id: currentTask.user.id }
                    : null}
                isUploadingDescription={uploadingDescription}
                hasDraft={hasDraft}
                draftsFromTQ={draftsFromTQ}
              />
            );
          } else if (currentItemIndex === descriptionBottomVirtualIndex) {
            contentToRender = <div id="bottom-description" className="h-0" />;
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
                    <CommentsContainer />
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
            // Uploading comments section
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
            return null; // Should not happen with correct indexing
          }

          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
                zIndex: 2000 - vItem.index,
              }}
            >
              {contentToRender}
            </div>
          );
        })}
      </div>
      {!_mbl && <NewCommentComponent />}
      {/* HTPR-5513: trailing space below the composer lives INSIDE this column
          so the properties rail's containing block (the column + rail row)
          reaches the end of the page. Put it on the page wrapper instead and
          the sticky rail is dragged up by that height at the bottom of a long
          thread. Heights mirror the padding this replaces. */}
      {!_mbl && (
        <div aria-hidden className="shrink-0 @sm:h-6 @lg:h-16 @xl:h-48" />
      )}
      {/* Final bottom div - only if not mobile */}
      {/* {!_mbl && <div id="bottom" className="h-0" />} */}
    </BaseCommentAndDescriptionContainer>
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
        <DescriptionReactions />
        {isUploadingDescription || hasDraft ? null : (
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
