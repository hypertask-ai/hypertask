import dynamic from "next/dynamic";
import { instrumentedDynamicImport } from "@/lib/analytics/taskDetailPhaseTimings";
import { TaskRelations, ICycle } from "@/models/model";
import { showAIChatInterfaceAtom, isAiChatSidebarModeAtom } from "@/store";
import DescriptionAndCommentsProvider from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6899_STABLE_LAYOUT_FLAG, HTPR_7055_AI_SIDEBAR_DETAIL_FIT_FLAG } from "@/lib/flags/keys";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";

import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";

import { useRecoilState } from "@/lib/state";

// const HypertasksCommands = dynamic(() => import("@/components/commands"), { ssr: false });
const KeyboardShortcuts = dynamic(
  instrumentedDynamicImport("KeyboardShortcuts", () => import("@/components/sidebars/keyboardShortcuts")),
  { ssr: false }
);
const DeleteCommentById = dynamic(
  instrumentedDynamicImport("DeleteCommentById", () => import("@/components/Modals/commands/DeleteCommentById")),
  { ssr: false }
);
const NewCommentComponent = dynamic(
  instrumentedDynamicImport(
    "NewCommentComponent",
    () =>
      import(
        "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent"
      ),
  )
);
const TaskMovement = dynamic(
  instrumentedDynamicImport("TaskMovement", () => import("@/components/PageComponents/TaskDetail/TaskMovement"))
);

const Tooltip = dynamic(instrumentedDynamicImport("Tooltip", () => import("@/components/Common/Tooltip")), {
  ssr: false,
});
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
const AttachmentCarousel = dynamic(
  instrumentedDynamicImport("AttachmentCarousel", () => import("@/components/Common/AttachmentsView/AttachmentsCarousel")),
  { ssr: false }
);

const ConfirmTaskDelete = dynamic(
  instrumentedDynamicImport("ConfirmTaskDelete", () => import("@/components/Modals/confirmDeleteModals/confirmtTaskDelete"))
);
const MoveTaskGlobal = dynamic(
  instrumentedDynamicImport("MoveTaskGlobal", () => import("@/components/Modals/MoveTaskToBoard"))
);
import SubtaskLinkingModal from "@/components/Modals/SubtaskLinkingModal/SubtaskLinking";
import { CommandMode } from "@/models/enums";
import RemoveSubtaskModal from "@/components/Modals/SubtaskLinkingModal/RemoveSubtask";
import TaskInfo from "@/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo";
import RemindMeComponent from "@/components/Modals/RemindMe/RemindMeComponent";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import type { TaskDetailContext } from "./TaskDetailContext";
export function TaskDetailPanels(context: TaskDetailContext) {
  const { embedded, _slugs, currentTask, setCurrentTask, showCommands, callback, commandContextOptions, showShortucts, scrollElementRef, _mbl, currentItemInTasksPlaylist, navigateToNextTask, searchParams, navigateToPreviousTask, dynamicElementRef, toggleDueDate, showAssignModal, toggleModal, _parsedTask, estimate_, priority_, labelsFromTQ, removeRelationHandler, toggleEstimateModal, toggleLabelModal, toggleMoveModal, toggleMoveToBoardModal, togglePriorityModal, dynamicTopValue, sectionsForProjectTQ, moveTaskToNextColumn, followers, onGoback, appShellRailOn, showTaskDeleteModal, deleteTask, carousalItems, setCarousalItems, showLinksModal, idToDelete, currentId, linksModalToggle, showMoveModal, moveTaskModalCallback, taskUpdateCommentsInCache, showCommentDeleteModal, setShowCommentDeleteModal, comments, setComments, showPriorityModal, showEstimateModal, showMoveTaskToBoard, setShowMoveTaskToBoard, showCreateLabelModal, setShowCreateLabelModal, setShowCommands, showDueDateModal, setDueDateCallback, showSubtaskLinkingModal, toggleSubtaskLinkingModal, callBackHandlerSubtaskLinking, showRemoveSubtaskModal, toggleRemoveSubtaskModal, callBackHandlerRemoveSubtask, showRemindMeModal, toggleRemindMeModal, currentUser } = context;


  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const stableLayoutFlag = useFlag(HTPR_6899_STABLE_LAYOUT_FLAG);
  const detailFit = useFlag(HTPR_7055_AI_SIDEBAR_DETAIL_FIT_FLAG);
  const { secondaryPanelsReady, cachedLayout } = useTaskContext();
  if (!currentTask) return <></>;

  const updateWaitingOn = (fields: {
    waitingOnUserId: number | null;
    waitingOnSetById: number | null;
    waitingOnSetAt: string | null;
  }) => setCurrentTask((task) => (task ? { ...task, ...fields } : task));
  const updateCycle = (cycle: ICycle | null) =>
    setCurrentTask((task) =>
      task ? { ...task, cycle, cycleId: cycle?.id ?? null } : task,
    );

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
            data-task-detail-path={`/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`}
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
                style={{
                  display: "flex",
                  flex: 1,
                  width: "100%",
                  // Keep the thread's minimum width without pushing properties under AI chat.
                  flexWrap: detailFit && !_mbl ? "wrap" : undefined,
                }}
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
                {!_mbl && ((stableLayoutFlag && cachedLayout) || secondaryPanelsReady !== false) && (
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
                {_mbl && !embedded && secondaryPanelsReady !== false && (instantTicketOpen ? <Suspense fallback={null}><NewCommentComponent /></Suspense> : <NewCommentComponent />)}
              </TaskDetailMainContainer>
            </MobileTaskDetailSwipe>
          </div>
          {_mbl && embedded && secondaryPanelsReady !== false && (instantTicketOpen ? <Suspense fallback={null}><NewCommentComponent /></Suspense> : <NewCommentComponent />)}

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

      {showLinksModal && _parsedTask && (
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
          currentTaskId={_parsedTask.id}
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


const DesktopNavigation = ({
  onGoback,
  navigateToNextTask,
  navigateToPreviousTask,
  currentItemInTasksPlaylist,
  appShellRail,
  left,
}: {
  onGoback: () => void;
  navigateToNextTask: any;
  navigateToPreviousTask: any;
  appShellRail?: boolean;
  left?: number | string;
  currentItemInTasksPlaylist: {
    projectId: number;
    uniqueIndex: any;
  };
}) => {
  const [showAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [isSidebarMode] = useRecoilState(isAiChatSidebarModeAtom);
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  return (
    <div
      // className="fixed  flex gap-2  items-center  flex-col xl:flex-row xl:left-10 left-5"
      className={`fixed  flex gap-2  items-center  flex-col left-3 ${
        showAiChatInterface && isSidebarMode ? "" : "xl:flex-row"
      } ${showAiChatInterface && isSidebarMode ? "" : "xl:left-10"}`}
      style={{
        zIndex: 51,
        top: taskDetailConfig.dimensions.desktopNavigation.top,
        left,
        justifyContent: "center",
      }}
    >
      <div
        id={taskDetailConfig.elementIds.taskDetailPageBackButton}
        onClick={onGoback}
        style={{
          width: taskDetailConfig.dimensions.backButton.size,
          height: taskDetailConfig.dimensions.backButton.size,
          borderRadius: taskDetailConfig.dimensions.backButton.borderRadius,
        }}
        className={`cursor-pointer justify-center items-center flex group ${
          appShellRail
            ? "text-text-light-gray hover:text-white-black"
            : "bg-back-button text-button-arrow shadow-md border-light-black-border-4"
        }`}
      >
        <ArrowLeft size={18} strokeWidth={1.75}/>
        {instantTicketOpen ? <Suspense fallback={null}>
          <Tooltip left={taskDetailConfig.dimensions.tooltip.leftOffset} bottom={taskDetailConfig.dimensions.tooltip.bottomOffset} text="Back" keyCombination={[...taskDetailConfig.keyboard.escapeCombination]} />
        </Suspense> : <Tooltip left={taskDetailConfig.dimensions.tooltip.leftOffset} bottom={taskDetailConfig.dimensions.tooltip.bottomOffset} text="Back" keyCombination={[...taskDetailConfig.keyboard.escapeCombination]} />}
      </div>
      {instantTicketOpen ? <Suspense fallback={null}>
        <TaskMovement
          currentItemInTasksPlaylist={currentItemInTasksPlaylist}
          navigateToNextTask={navigateToNextTask}
          navigateToPreviousTask={navigateToPreviousTask}
        />
      </Suspense> : <TaskMovement currentItemInTasksPlaylist={currentItemInTasksPlaylist} navigateToNextTask={navigateToNextTask} navigateToPreviousTask={navigateToPreviousTask} />}
    </div>
  );
};
