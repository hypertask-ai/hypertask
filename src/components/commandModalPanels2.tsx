import { SwipeUnread, FeedbackModal, TrialModal, MoveTaskGlobal, TaskRelationPicker, SignOutModal, ConfirmTaskDelete, ConfirmArchiveBoard, ConfirmDeleteBoard, AllFilterHTC, DeleteMessage, DueDateModal, StartDateModal, OptionPickerModal, AssignModal, BlockedByPersonModal, AutoAssignColumn, CreateTeam, CreateBoard, BoardCreationAssistant, ManageFavorites, AddColumn, MoveToColumn, ManageColumns, EditBoard, InviteMember, BoardPriorityMode, ManageLabels, SetPriorityModal, TaskEstimateModal, SubtaskSettings, ManageViews, SmartSplitModal, ViewsForBoard, SubtaskLinkingModal, ShareTaskModal, McpTokenModal, SwitchAccountModal, CliInstallModal, RestApiModal, TableColumnsPicker, ManageCustomFieldsModal, RenameTaskModal, AgentModal, CreateCustomFieldModal, TaskDescriptionHistoryModal } from "./commandModals";
import { type IShowHypertaskHTC } from "@/store";
import { CommandMode } from "@/models/enums";
import { IProject } from "@/models/model";
import toast from "react-hot-toast";
import { RECURRENCE_LABELS, RECURRENCE_RULES } from "@/lib/recurrence";
import Commands from "./Modals/commands/HTC/commands";
import RemindMeComponent from "./Modals/RemindMe/RemindMeComponent";
import InboxZeroSheet from "@/components/notifications/InboxZeroSheet";
import CreateLabel from "./Modals/CreateLabel/CreateLabel";
import type { useCommandsState } from "./useCommandsState";
import type { createBoardCommandActions } from "./boardCommandActions";
import type { createGeneralCommandActions } from "./generalCommandActions";
import type { createCommandModalCallbacks } from "./commandModalCallbacks";
import type { createCommandDispatcher } from "./commandDispatcher";
import type { IHTCProps } from "./commandTypes";


type Context = Pick<IHTCProps & ReturnType<typeof useCommandsState> & ReturnType<typeof createBoardCommandActions> & ReturnType<typeof createGeneralCommandActions> & ReturnType<typeof createCommandModalCallbacks> & ReturnType<typeof createCommandDispatcher>, "focusProxy" | "isMbl" | "commandMode" | "handleAction" | "paletteContextOptions" | "billing" | "appShellRailOn" | "showCommands" | "currentUser" | "boardCloseHandler" | "_currentProject" | "refreshRowTaskList" | "relationPicker" | "activeTaskId" | "callbackHandler" | "archiveHandler" | "confirmDelete" | "DeleteMessageHandler" | "setDueDateCallback" | "queryClient" | "inViewObject" | "_activeTask" | "setRecurrenceHandler" | "taskTemplatePickerForCurrentProject" | "openTaskTemplateHandler" | "myTasksBulkSelectionEnabled" | "hasBulkSelection" | "kanbanBulkSelection" | "bulkSelection" | "bulkTasks" | "bulkActionProjectId" | "_activeTaskAssignees" | "toggleAssignModal" | "taskProject" | "updateAutoAssignHandler" | "createBoard" | "createColumn" | "contextOptions" | "toggleManageColumns" | "updateBoard" | "reSendInvite" | "cancelInvite" | "inviteNewMemberHandlerLocal" | "removeMemberLocal" | "addAgentToBoardLocal" | "removeAgentFromBoardLocal" | "callbackProjectId" | "toggleBoardSortingHandler" | "togglePriorityModal" | "toggleEstimateModal" | "setShowCommands" | "setCommandMode" | "toggleLabelModal" | "myTasksSnoozeEnabled" | "togglRemindMeModal" | "toggleSubTaskSettingsHandler" | "toggleManageViewsHandler" | "toggleBoardViewsHandler" | "toggleSubtaskLinkingHandler" | "onMyTasks" | "myTasksViewsEnabled" | "myTasksTableColumnsEnabled" | "toggleRenameTaskModal" | "agentToEdit" | "closeCallbackCreateAgent" | "inboxZeroRules">;

export function renderCommandModals2(context: Context) {
  const {
  isMbl, commandMode, handleAction, paletteContextOptions, billing,
  appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
  refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
  confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
  _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
  hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
  _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
  createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
  cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
  callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
  setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
  myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
  } = context;
  return (<><div
        id="htc-container"
        className={
          isMbl
            // Mobile: this transparent full-screen layer only positions inline
            // palette content, but reactstrap command sub-modals (Set theme,
            // Set priority, …) portal to <body> at a LOWER z-index than this
            // z-[9999] overlay — so the overlay sat on top of them and swallowed
            // every tap (visible but dead). pointer-events-none lets taps fall
            // through to those portaled modals; the inner wrapper re-enables
            // pointer events for content that renders inline here.
            ? "fixed inset-0 z-[9999] bg-transparent pointer-events-none"
            : "fixed left-0 right-0 top-[180px] z-[9999] flex items-center justify-center bg-transparent"
        }
      >
        <div className={isMbl ? "bg-transparent pointer-events-auto" : "rounded-[5px] bg-modalBackground customshadow-4"}>
          {renderPaletteModalGroup1(context)}
          {renderPaletteModalGroup2(context)}
          {renderPaletteModalGroup3(context)}
          {renderPaletteModalGroup4(context)}
</div>
      </div>
   </>);
}

function renderPaletteModalGroup1(context: Context) {
  const {
  isMbl, commandMode, handleAction, paletteContextOptions, billing,
  appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
  refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
  confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
  _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
  hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
  _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
  createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
  cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
  callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
  setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
  myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
  } = context;
  return (<>
          {commandMode === CommandMode.Command && (
            <Commands
              focusProxy={context.focusProxy}
              isOpen={commandMode === CommandMode.Command}
              handleAction={handleAction}
              contextOptions={paletteContextOptions}
              showByokApiKeys={billing?.storePlanId === "BYOK"}
              appShellRailOn={appShellRailOn && !isMbl}
              scope={(showCommands as IShowHypertaskHTC).scope}
            />
          )}

          {commandMode === CommandMode.SwipeThroughUnread && (
            <SwipeUnread
              userId={currentUser.id}
              onClose={boardCloseHandler}
            />
          )}

          {commandMode === CommandMode.SendFeedback && (
            <FeedbackModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.TrialModal && _currentProject && (
            <TrialModal closeCallback={boardCloseHandler} />
          )}
          {commandMode === CommandMode.MoveTaskToBoard && (
            <MoveTaskGlobal
              closeHTC={() => {
                boardCloseHandler();
                refreshRowTaskList();
              }}
            />
          )}
          {relationPicker && activeTaskId && (
            <TaskRelationPicker
              closeHandler={boardCloseHandler}
              currentTaskId={activeTaskId}
              header={relationPicker.header}
              relationType={relationPicker.relationType}
              onRelationAdded={async (relations) => {
                await callbackHandler?.(relations, "AddRelation");
                if (commandMode === CommandMode.DeclineAsDuplicateOf) {
                  // Archive in its own try so a failure here is not reported as
                  // a relation error (the relation already succeeded) and does
                  // not block the picker from closing.
                  try {
                    await archiveHandler();
                  } catch {
                    toast.error("Marked as duplicate, but could not archive the task");
                  }
                }
              }}
            />
          )}
          {commandMode === CommandMode.Logout && (
            <SignOutModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.DeleteTask && (
            <ConfirmTaskDelete
              confirmDelete={async (response) => {
                await confirmDelete(response);
                if (response) refreshRowTaskList();
              }}
              content="Clicking confirm will delete this task! Task can be recovered within 30 days."
            />
          )}
          {commandMode === CommandMode.ArchiveBoard && (
            <ConfirmArchiveBoard onClose={boardCloseHandler} />
          )}
          {commandMode === CommandMode.DeleteBoard && (
            <ConfirmDeleteBoard onClose={boardCloseHandler} />
          )}

          {commandMode === CommandMode.ShowFilterHTC && (
            <AllFilterHTC toggle={boardCloseHandler} view="Kanban" />
          )}

          {commandMode === CommandMode.DeleteMessage && (
            <DeleteMessage callback={DeleteMessageHandler} />
          )}
          {commandMode === CommandMode.SetDueDate && (
            <DueDateModal
              mode={"Update"}
              closeHandler={(callback, reset) => {
                boardCloseHandler();
                if (callback) setDueDateCallback(callback);
                else if (reset) setDueDateCallback(undefined);
                if (callback || reset) refreshRowTaskList();
              }}
            />
          )}
          {commandMode === CommandMode.SetStartDate && (
            <StartDateModal
              closeHandler={(date, reset) => {
                boardCloseHandler();
                if (date || reset) {
                  queryClient.invalidateQueries({
                    queryKey: ["task-", inViewObject.taskId],
                  });
                  if (callbackHandler) callbackHandler(date ?? undefined, "StartDate");
                }
              }}
            />
          )}
          {commandMode === CommandMode.SetRecurrence && (
            <OptionPickerModal
              header="Repeat task"
              placeholder="Type to filter…"
              options={[
                ...(_activeTask?.recurrence
                  ? [{ id: null, label: "Don't repeat" }]
                  : []),
                ...RECURRENCE_RULES.map((rule) => ({
                  id: rule,
                  label: RECURRENCE_LABELS[rule],
                  hint: _activeTask?.recurrence === rule ? "Current" : undefined,
                })),
              ]}
              onSelect={setRecurrenceHandler}
              onClose={boardCloseHandler}
            />
          )}
          {commandMode === CommandMode.NewTaskFromTemplate && (
            <OptionPickerModal
              header="New task from template"
              placeholder="Type to filter templates…"
              options={taskTemplatePickerForCurrentProject.templates.map(
                (template) => ({
                  id: template.id,
                  label: template.name,
                }),
              )}
              emptyMessage="No templates yet — use “Save task as template” on a task first"
              onSelect={openTaskTemplateHandler}
              onClose={boardCloseHandler}
            />
          )}
         </>);
}

function renderPaletteModalGroup2(context: Context) {
  const {
  isMbl, commandMode, handleAction, paletteContextOptions, billing,
  appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
  refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
  confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
  _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
  hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
  _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
  createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
  cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
  callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
  setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
  myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
  } = context;
  return (<>{commandMode === CommandMode.OpenAssignModal && (
            myTasksBulkSelectionEnabled && hasBulkSelection && !kanbanBulkSelection ? (
              bulkSelection && bulkTasks[0] && bulkActionProjectId ? (
              <AssignModal
                onClose={boardCloseHandler}
                project={{ id: bulkActionProjectId } as IProject}
                task={{
                  id: bulkTasks[0].id,
                  title: bulkTasks[0].title,
                  link: "",
                }}
                assignees={_activeTaskAssignees}
                bulkTaskIds={bulkTasks.map((task) => task.id)}
                onBulkAssign={(assignee) =>
                  bulkSelection.assignSelected(assignee, "assign")
                }
              />
              ) : null
            ) : hasBulkSelection ? (
              bulkSelection && bulkTasks[0] && bulkActionProjectId ? (
              <AssignModal
                onClose={boardCloseHandler}
                project={{ id: bulkActionProjectId } as IProject}
                task={{
                  id: bulkTasks[0].id,
                  title: bulkTasks[0].title,
                  link: "",
                }}
                assignees={_activeTaskAssignees}
                bulkTaskIds={bulkTasks.map((task) => task.id)}
                onBulkAssign={(assignee) =>
                  bulkSelection.assignSelected(assignee, "assign")
                }
              />
              ) : null
            ) : inViewObject.taskId ? (
            <AssignModal
              onClose={toggleAssignModal}
              project={taskProject ?? undefined}
              task={{
                id: inViewObject.taskId,
                title: inViewObject.taskTitle ?? "",
                link: "",
              }}
              assignees={_activeTaskAssignees}
            />
            ) : null
          )}
          {commandMode === CommandMode.OpenBlockedByModal &&
            inViewObject.taskId && (
              <BlockedByPersonModal
                taskId={inViewObject.taskId}
                projectId={
                  _activeTask?.projectId ?? inViewObject.taskProjectId ?? 0
                }
                waitingOnUserId={_activeTask?.waitingOnUserId}
                onClose={(fields) => {
                  if (fields && callbackHandler) {
                    callbackHandler(fields, "WaitingOn");
                  }
                  boardCloseHandler();
                }}
              />
            )}
          {commandMode === CommandMode.AutoAssignColumn && _currentProject && (
            <AutoAssignColumn
              project={_currentProject}
              onClose={boardCloseHandler}
              onSelect={updateAutoAssignHandler}
            />
          )}
          {commandMode === CommandMode.CreateTeam &&
            currentUser.UserSetting.trialStatus && (
              <CreateTeam createBoard={createBoard} />
            )}
          {commandMode === CommandMode.NewBoard && (
            <CreateBoard
              createBoard={createBoard}
              payload={showCommands.payload}
            />
          )}
          {commandMode === CommandMode.BoardCreationAssistant && (
            <BoardCreationAssistant onClose={boardCloseHandler} />
          )}
          {commandMode === CommandMode.ManageFavorites && (
            <ManageFavorites onClose={boardCloseHandler} />
          )}

          {commandMode === CommandMode.AddColumn && (
            <AddColumn
              createColumn={createColumn}
              toggleModal={boardCloseHandler}
              // hideColumn ={hideColumn}
              // renameColumn =
            />
          )}

          {
            commandMode === CommandMode.MoveToColumn &&
            (hasBulkSelection ? (
              bulkSelection && bulkTasks[0] && bulkActionProjectId ? (
              <MoveToColumn
                projectId={bulkActionProjectId}
                task={{
                  taskId: bulkTasks[0].id,
                  projectId: bulkTasks[0].projectId,
                  sectionId: bulkTasks[0].sectionId ?? null,
                }}
                bulkTaskIds={bulkTasks.map((task) => task.id)}
                onBulkMove={(section) => bulkSelection.moveSelected(section)}
                moveTaskToColumnHandler={boardCloseHandler}
                title="Move selected tasks to column"
              />
              ) : null
            ) : (
            contextOptions?.task && (
              <MoveToColumn
                projectId={contextOptions.task.projectId}
                task={contextOptions.task}
                moveTaskToColumnHandler={() => {
                  boardCloseHandler();
                  refreshRowTaskList();
                }}
              />
            )
            ))
          }
          {(commandMode === CommandMode.ManageColumn ||
            commandMode === CommandMode.DeleteColumn ||
            commandMode === CommandMode.RenameColumn) && (
            <ManageColumns toggleModal={toggleManageColumns} />
          )}

          {commandMode === CommandMode.EditBoard && (
            <EditBoard updateBoard={updateBoard} />
          )}

          {commandMode === CommandMode.BoardJoinResetLink && (
            <InviteMember
              startingScreen="ShareLink"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
         </>);
}

function renderPaletteModalGroup3(context: Context) {
  const {
  isMbl, commandMode, handleAction, paletteContextOptions, billing,
  appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
  refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
  confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
  _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
  hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
  _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
  createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
  cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
  callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
  setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
  myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
  } = context;
  return (<>{commandMode === CommandMode.InviteMember && (
            <InviteMember
              startingScreen="Home"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
          {commandMode === CommandMode.ManageMembers && (
            <InviteMember
              startingScreen="Home"
              reSendInvite={reSendInvite}
              cancelInvite={cancelInvite}
              closeHandler={boardCloseHandler}
              inviteNewMember={inviteNewMemberHandlerLocal}
              removeMember={removeMemberLocal}
              addAgentToBoard={addAgentToBoardLocal}
              removeAgentFromBoard={removeAgentFromBoardLocal}
              optionalProjectId={callbackProjectId}
            />
          )}
          {commandMode === CommandMode.SortKanbanBoard && (
            <BoardPriorityMode closeHandler={toggleBoardSortingHandler} />
          )}
          {commandMode === CommandMode.ManageLabels && (
            <ManageLabels
              onClose={boardCloseHandler}
              // closeHandler={boardCloseHandler}
            />
          )}
          {commandMode === CommandMode.PriorityModal && (
            <SetPriorityModal mode="Task" closeHandler={togglePriorityModal} />
          )}
          {commandMode === CommandMode.EstimateModal && (
            <TaskEstimateModal mode="Task" closeHandler={toggleEstimateModal} />
          )}

          {commandMode === CommandMode.LabelModal && (
            hasBulkSelection ? (
              bulkSelection && bulkActionProjectId ? (
              <CreateLabel
                currentProject={{ id: bulkActionProjectId } as IProject}
                taskIds={bulkTasks.map((task) => task.id)}
                onBulkLabel={(label) => bulkSelection.labelSelected(label)}
                closeHandler={boardCloseHandler}
                onManageTags={() => {
                  setShowCommands({
                    show: true,
                    mode: CommandMode.ManageLabels,
                  });
                  setCommandMode(CommandMode.ManageLabels);
                }}
              />
              ) : null
            ) : (
            <CreateLabel
              closeHandler={toggleLabelModal}
              currentProject={taskProject ?? undefined}
              onManageTags={() => {
                setShowCommands({
                  show: true,
                  mode: CommandMode.ManageLabels,
                });
                setCommandMode(CommandMode.ManageLabels);
              }}
            />
            )
          )}
          {(commandMode === CommandMode.RemindMe ||
            (myTasksSnoozeEnabled && commandMode === CommandMode.MyTasksSnooze)) && (
            <RemindMeComponent
              closeHandler={togglRemindMeModal}
              remindTask={
                contextOptions?.taskOptions?.isMyTasks ||
                showCommands.payload?.returnsToMyTasks
                  ? false
                  : undefined
              }
              returnsToMyTasks={
                myTasksSnoozeEnabled &&
                (typeof showCommands.payload?.returnsToMyTasks === "boolean"
                  ? showCommands.payload.returnsToMyTasks
                  : Boolean(contextOptions?.taskOptions?.isMyTasks))
              }
            />
          )}
          {commandMode === CommandMode.SubtaskSettings && (
            <SubtaskSettings toggle={toggleSubTaskSettingsHandler} />
          )}
          {commandMode === CommandMode.ManageViews && (
            <ManageViews toggle={toggleManageViewsHandler} />
          )}
          {commandMode === CommandMode.CreateSmartSplit && _currentProject && (
            <SmartSplitModal
              projectId={_currentProject.id}
              onClose={toggleManageViewsHandler}
            />
          )}
          {commandMode === CommandMode.ShowBoardViews && _currentProject && (
            <ViewsForBoard
              toggle={toggleBoardViewsHandler}
              project={_currentProject as IProject}
            />
          )}
          {commandMode === CommandMode.CreateSubTask && inViewObject && (
            <SubtaskLinkingModal
              closeHandler={toggleSubtaskLinkingHandler}
              taskInfo={{
                id: inViewObject.taskId!,
                projectId: inViewObject.taskProjectId!,
                section: inViewObject.sectionTitle!,
                sectionId: inViewObject.sectionId!,
                title: inViewObject.taskTitle!,
                ticketNumber: inViewObject.taskTicketNumber!,
              }}
            />
          )}
          {commandMode === CommandMode.ShareTaskPublic && inViewObject && (
            <ShareTaskModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.GenerateMcpToken && (
            <McpTokenModal
              currentUser={currentUser}
              closeHandler={boardCloseHandler}
              onOpenCli={() => handleAction(CommandMode.CliInstall)}
            />
          )}
          {commandMode === CommandMode.SwitchAccount && (
            <SwitchAccountModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.CliInstall && (
            <CliInstallModal
              closeHandler={boardCloseHandler}
              onOpenMcp={() => handleAction(CommandMode.GenerateMcpToken)}
            />
          )}
          {commandMode === CommandMode.RestApi && (
            <RestApiModal
              closeHandler={boardCloseHandler}
              onOpenMcp={() => handleAction(CommandMode.GenerateMcpToken)}
              onOpenCli={() => handleAction(CommandMode.CliInstall)}
            />
          )}
          {commandMode === CommandMode.ConfigureTableColumns &&
            !(onMyTasks && myTasksViewsEnabled && myTasksTableColumnsEnabled) && (
            <TableColumnsPicker closeHandler={boardCloseHandler} projectId={_currentProject?.id} />
          )}
          {commandMode === CommandMode.ManageCustomFields && (
            <ManageCustomFieldsModal closeHandler={boardCloseHandler} projectId={_currentProject?.id} />
          )}
         </>);
}

function renderPaletteModalGroup4(context: Context) {
  const {
  isMbl, commandMode, handleAction, paletteContextOptions, billing,
  appShellRailOn, showCommands, currentUser, boardCloseHandler, _currentProject,
  refreshRowTaskList, relationPicker, activeTaskId, callbackHandler, archiveHandler,
  confirmDelete, DeleteMessageHandler, setDueDateCallback, queryClient, inViewObject,
  _activeTask, setRecurrenceHandler, taskTemplatePickerForCurrentProject, openTaskTemplateHandler, myTasksBulkSelectionEnabled,
  hasBulkSelection, kanbanBulkSelection, bulkSelection, bulkTasks, bulkActionProjectId,
  _activeTaskAssignees, toggleAssignModal, taskProject, updateAutoAssignHandler, createBoard,
  createColumn, contextOptions, toggleManageColumns, updateBoard, reSendInvite,
  cancelInvite, inviteNewMemberHandlerLocal, removeMemberLocal, addAgentToBoardLocal, removeAgentFromBoardLocal,
  callbackProjectId, toggleBoardSortingHandler, togglePriorityModal, toggleEstimateModal, setShowCommands,
  setCommandMode, toggleLabelModal, myTasksSnoozeEnabled, togglRemindMeModal, toggleSubTaskSettingsHandler,
  toggleManageViewsHandler, toggleBoardViewsHandler, toggleSubtaskLinkingHandler, onMyTasks, myTasksViewsEnabled,
  myTasksTableColumnsEnabled, toggleRenameTaskModal, agentToEdit, closeCallbackCreateAgent, inboxZeroRules,
  } = context;
  return (<>{commandMode === CommandMode.RenameTask && inViewObject && (
            <RenameTaskModal closeCallback={toggleRenameTaskModal} />
          )}
          {commandMode === CommandMode.CreateAgent && (
            <AgentModal key={agentToEdit?.id ?? "create"} closeHandler={closeCallbackCreateAgent} />
          )}
          {/* Managing agents and reviewing switched-off ones is the /agents
              page now, so neither modal is rendered from the palette. */}
          {commandMode === CommandMode.CreateCustomField && (
            <CreateCustomFieldModal closeHandler={boardCloseHandler} />
          )}
          {commandMode === CommandMode.TaskDescriptionVersions && activeTaskId && (
            <TaskDescriptionHistoryModal
              taskId={activeTaskId}
              onClose={boardCloseHandler}
              onRestored={() => callbackHandler?.(undefined, "DescriptionRestored")}
            />
          )}
          {inboxZeroRules && (
            <InboxZeroSheet
              key={commandMode}
              initialRules={inboxZeroRules}
              onClose={boardCloseHandler}
            />
          )}
       </>);
}
