import { AttachmentCarousel, ConfirmTaskDelete, DeleteCommentById, DesktopNavigation, KeyboardShortcuts, MoveTaskGlobal, NewCommentComponent } from "./TaskDetailPanelParts";
import "@/styles/taskDetail.scss";
import { TaskRelations } from "@/models/model";
import DescriptionAndCommentsProvider from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { Suspense } from "react";
import LinksModal from "@/components/Modals/LinksModal";
import TaskEstimateModal from "@/components/Modals/TaskEstimate/TaskEstimate";
import CreateLabel from "@/components/Modals/CreateLabel/CreateLabel";
import TaskDetailMainContainer from "@/components/PageComponents/TaskDetail/TaskDetailMainContainer";
import MobileTaskDetailSwipe from "@/components/PageComponents/TaskDetail/MobileTaskDetailSwipe";
import TaskDetailTitleContainer from "@/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer";
import CommentAndDescriptionContainer from "@/components/PageComponents/TaskDetail/CommentAndDescription";
import DueDateModal from "@/components/Modals/DueDate";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { APP_SHELL_RAIL_OFFSET } from "@/lib/constants/appShellRail";
import HypertasksCommands from "@/components/commands";
import SetPriorityModal from "@/components/Modals/TaskPriority";
import MoveToColumn from "@/components/Modals/commands/moveToColumn";
import SubtaskLinkingModal from "@/components/Modals/SubtaskLinkingModal/SubtaskLinking";
import { CommandMode } from "@/models/enums";
import RemoveSubtaskModal from "@/components/Modals/SubtaskLinkingModal/RemoveSubtask";
import TaskInfo from "@/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo";
import RemindMeComponent from "@/components/Modals/RemindMe/RemindMeComponent";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";

type ViewContext = Record<string, any>;

export function renderTaskDetailPanels(context: ViewContext) {
  const { callback, _currentTask, _mbl, _parsedTask, _slugs, appShellRailOn, callBackHandlerRemoveSubtask, callBackHandlerSubtaskLinking, carousalItems, commandContextOptions, comments, currentId, currentItemInTasksPlaylist, currentTask, currentUser, deleteTask, dynamicElementRef, dynamicTopValue, embedded, estimate_, followers, idToDelete, labelsFromTQ, linksModalToggle, moveTaskModalCallback, moveTaskToNextColumn, navigateToNextTask, navigateToPreviousTask, onGoback, priority_, removeRelationHandler, scrollElementRef, searchParams, sectionsForProjectTQ, setCarousalItems, setComments, setDueDateCallback, setShowCommands, setShowCommentDeleteModal, setShowCreateLabelModal, setShowMoveTaskToBoard, showAssignModal, showCommands, showCommentDeleteModal, showCreateLabelModal, showDueDateModal, showEstimateModal, showLinksModal, showMoveModal, showMoveTaskToBoard, showPriorityModal, showRemindMeModal, showRemoveSubtaskModal, showShortucts, showSubtaskLinkingModal, showTaskDeleteModal, taskUpdateCommentsInCache, toggleDueDate, toggleEstimateModal, toggleLabelModal, toggleModal, toggleMoveModal, toggleMoveToBoardModal, togglePriorityModal, toggleRemindMeModal, toggleRemoveSubtaskModal, toggleSubtaskLinkingModal, updateCycle, updateWaitingOn } = context;
const content = (
    <>
      {/* HTPR-6277: command modals (ShareTaskModal, etc.) are next/dynamic and
          suspend on first open. Without a local boundary that suspend bubbles
          into page.tsx's Suspense, the whole task detail swaps to "Loading...",
          document height collapses, and window scroll jumps to 0. Homepage and
          TableView already isolate commands the same way. */}
      {!embedded && showCommands.show && (
        <Suspense fallback={null}>
          <HypertasksCommands
            callbackHandler={callback}
            contextOptions={commandContextOptions}
          />
        </Suspense>
      )}
      {showShortucts && <KeyboardShortcuts />}
      <>
        <DescriptionAndCommentsProvider>
          <div
            ref={embedded ? scrollElementRef : undefined}
            className={
              embedded
                ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
                : "contents"
            }
          >
            <MobileTaskDetailSwipe
              enabled={_mbl && !embedded}
              currentItem={currentItemInTasksPlaylist}
              onNext={() =>
                navigateToNextTask(
                  false,
                  true,
                  undefined,
                  undefined,
                  searchParams?.get(taskDetailConfig.searchParams.inboxFlow),
                )
              }
              onPrevious={() =>
                navigateToPreviousTask(
                  false,
                  false,
                  searchParams?.get(taskDetailConfig.searchParams.inboxFlow),
                )
              }
            >
              <TaskDetailMainContainer>
                <TaskDetailTitleContainer
                  containerRef={dynamicElementRef}
                  toggleDueDate={toggleDueDate}
                />

              {/* --------------------------- COMMENTS + DESCRIPTION CONTAINER ------------------------------ */}
              <div
                id={taskDetailConfig.elementIds.taskInfoCommentsDescriptionContainer}
                className={`${_mbl ? "no-scrollbar scrollbar-none" : "mt-0 pl-1 task-detail-horizontal-padding"} `}
                style={{display: "flex",flex: 1,width: "100%",}}
              >
                {/* Not my proudest moment here but I will have to fix this. Reason why im double propping here is because the Task
                info column in part of virtualizer when on mobile. So I need to pass on the props inside there. */}
                <CommentAndDescriptionContainer
                  showAssignModal={showAssignModal}
                  toggleModal={toggleModal}
                  slugs={[_slugs[0], _slugs[1]]}
                  _parsedTask={_parsedTask}
                  currentTask={currentTask}
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
                {!_mbl && (
                  <TaskInfo
                    showAssignModal={showAssignModal}
                    toggleModal={toggleModal}
                    slugs={[_slugs[0], _slugs[1]]}
                    _parsedTask={_parsedTask}
                    currentTask={currentTask}
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
                )}
              </div>
                {_mbl && !embedded && <NewCommentComponent />}
              </TaskDetailMainContainer>
            </MobileTaskDetailSwipe>
          </div>
          {_mbl && embedded && <NewCommentComponent />}

          {
            // Hide Go Back only for Mobile Devices
            !_mbl && !embedded && (
              <DesktopNavigation
                onGoback={onGoback}
                currentItemInTasksPlaylist={currentItemInTasksPlaylist}
                navigateToNextTask={navigateToNextTask}
                navigateToPreviousTask={navigateToPreviousTask}
                appShellRail={appShellRailOn}
                left={appShellRailOn ? APP_SHELL_RAIL_OFFSET : undefined}
              />
            )
          }
        </DescriptionAndCommentsProvider>
      </>

      {/* ============================================= IMPORT AND USE MODALS HERE ================================= */}
      {showTaskDeleteModal && (
        <ConfirmTaskDelete
          confirmDelete={deleteTask}
          content={taskDetailConfig.deleteModal.confirmationMessage}
        />
      )}

      {carousalItems && (
        <AttachmentCarousel
          closeCallback={() => {
            setCarousalItems(undefined);
          }}
          attachments={carousalItems.attachments}
          currentIndex={carousalItems.currentIndex}
        />
      )}

      {showLinksModal && JSON.parse(_currentTask) && (
        <LinksModal
          subTasks={_parsedTask.subTasks}
          relatedTasks={[
            ...(currentTask.relatedFromTasks?.map(
              (rt: TaskRelations) => rt.targetTask as any
            ) ?? []),
            ...(currentTask.relatedToTasks?.map(
              (rt: TaskRelations) => rt.sourceTask as any
            ) ?? []),
          ]}
          parentTask={_parsedTask.parentTask}
          commentId={idToDelete ?? currentId}
          currentTaskId={JSON.parse(_currentTask).id}
          display={showLinksModal}
          onClose={linksModalToggle}
        />
      )}
      {/* Conditionally render the modal */}
      {showMoveModal && (
        <MoveToColumn
          key={taskDetailConfig.modalKeys.moveToColumn + currentTask?.id}
          projectId={currentTask.projectId}
          task={{
            taskId: currentTask.id,
            projectId: currentTask.projectId,
            sectionId: currentTask.sectionId ?? null,
          }}
          moveTaskToColumnHandler={toggleMoveModal}
          callback={moveTaskModalCallback}
          taskCacheCallback={taskUpdateCommentsInCache}
        />
      )}
      {showCommentDeleteModal && (
        <DeleteCommentById
          callback={callback}
          setShowCommentDeleteModal={setShowCommentDeleteModal}
          comments={comments}
          setComments={setComments}
        />
      )}
      {showPriorityModal && (
        <SetPriorityModal
          key={taskDetailConfig.modalKeys.setPriority + currentTask?.id}
          mode="Task"
          closeHandler={togglePriorityModal}
        />
      )}

      {showEstimateModal && (
        <TaskEstimateModal
          key={taskDetailConfig.modalKeys.setSize + currentTask?.id}
          mode="Task"
          closeHandler={toggleEstimateModal}
        />
      )}
      {showMoveTaskToBoard && (
        <MoveTaskGlobal closeHTC={() => setShowMoveTaskToBoard(false)} />
      )}

      {showCreateLabelModal && (
        <CreateLabel
          key={taskDetailConfig.modalKeys.tags + currentTask?.id}
          closeHandler={toggleLabelModal}
          onManageTags={() => {
            setShowCreateLabelModal(false);
            setShowCommands({ show: true, mode: CommandMode.ManageLabels });
          }}
        />
      )}
      {showDueDateModal && (
        <DueDateModal
          key={taskDetailConfig.modalKeys.dueDate + currentTask?.dueDate}
          dueDate={currentTask?.dueDate}
          mode={"Update"}
          closeHandler={(callback, reset) => {
            toggleDueDate();
            if (callback) setDueDateCallback(callback);
            else if (reset) setDueDateCallback(undefined);
          }}
        />
      )}
      {showSubtaskLinkingModal && (
        <SubtaskLinkingModal
          taskInfo={{
            id: currentTask.id,
            projectId: currentTask.projectId,
            section: currentTask?.section,
            sectionId: currentTask?.sectionId!,
            title: currentTask?.title,
            ticketNumber: currentTask?.ticketNumber,
          }}
          closeHandler={toggleSubtaskLinkingModal}
          callbackHandler={callBackHandlerSubtaskLinking}
        />
      )}
      {showRemoveSubtaskModal && (
        <RemoveSubtaskModal
          taskInfo={{
            subTasks: currentTask.subTasks,
          }}
          closeHandler={toggleRemoveSubtaskModal}
          callbackHandler={callBackHandlerRemoveSubtask}
        />
      )}
      {showRemindMeModal && (
        <RemindMeComponent closeHandler={toggleRemindMeModal} />
      )}
    </>
  );

if (embedded) {
    return <div className="flex h-full min-h-0 flex-col">{content}</div>;
  }

return appShellRailOn ? (
    <>
      <AppShellRail variant="global" currentUser={currentUser} />
      <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
    </>
  ) : content;
}
