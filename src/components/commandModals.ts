import dynamic from "next/dynamic";


// ─── Dynamic Imports ────────────────────────────────────────────────────────────
export const InviteMember = dynamic(() => import("./Modals/commands/inviteMember"));

export const EditBoard = dynamic(() => import("./Modals/commands/editBoard"));

export const CreateBoard = dynamic(() => import("./Modals/commands/createBoard"));

export const BoardCreationAssistant = dynamic(
  () => import("./Modals/BoardCreationAssistant")
);

export const AddColumn = dynamic(() => import("./Modals/commands/addColumn"));

export const CreateTeam = dynamic(() => import("./Modals/CreateTeam/CreateTeam"));

export const MoveTaskGlobal = dynamic(() => import("./Modals/MoveTaskToBoard"));

export const ConfirmTaskDelete = dynamic(
  () => import("./Modals/confirmDeleteModals/confirmtTaskDelete")
);

export const ConfirmArchiveBoard = dynamic(
  () => import("./Modals/commands/confirmArchiveBoard")
);

export const ConfirmDeleteBoard = dynamic(
  () => import("./Modals/commands/confirmDeleteBoard")
);

export const ManageLabels = dynamic(() => import("./Modals/ManageLabels"));

export const TrialModal = dynamic(() => import("./Modals/TrialPlan/TrialModal"));

export const SubtaskLinkingModal = dynamic(
  () => import("./Modals/SubtaskLinkingModal/SubtaskLinking")
);

export const McpTokenModal = dynamic(() => import("./Modals/McpToken/McpTokenModal"));

export const SwitchAccountModal = dynamic(
  () => import("./Modals/commands/SwitchAccount/SwitchAccountModal")
);

export const SignOutModal = dynamic(() => import("./Modals/SignOut/SignOutModal"));

export const CliInstallModal = dynamic(() => import("./Modals/CliInstall/CliInstallModal"));

export const RestApiModal = dynamic(() => import("./Modals/RestApi/RestApiModal"));

export const AgentModal = dynamic(() => import("./Modals/Agent/agent.modal"), {
  ssr: false,
});

export const Shortcut = dynamic(() => import("./sidebars/keyboardShortcuts"));

export const ManageColumns = dynamic(() => import("./Modals/commands/manageColumn"));

export const MoveToColumn = dynamic(() => import("./Modals/commands/moveToColumn"));

export const DeleteMessage = dynamic(() => import("./Modals/commands/DeleteMessage"));

export const ManageFavorites = dynamic(() => import("./Modals/ManageFavorites"));

export const SetPriorityModal = dynamic(() => import("./Modals/TaskPriority"));

export const BoardPriorityMode = dynamic(
  () => import("./Modals/Kanban/BoardPriorityMode")
);

export const TaskEstimateModal = dynamic(
  () => import("./Modals/TaskEstimate/TaskEstimate")
);

export const AllFilterHTC = dynamic(
  () => import("./Modals/FilterModals/SelectFilters/FilterHTC")
);

export const DueDateModal = dynamic(() => import("./Modals/DueDate"));

export const StartDateModal = dynamic(() => import("./Modals/StartDate"));

export const OptionPickerModal = dynamic(() => import("./Modals/OptionPicker"));

export const AssignModal = dynamic(() => import("./Modals/AssignToUser/AssignToUser"));

export const BlockedByPersonModal = dynamic(
  () => import("./Modals/BlockedByPerson/BlockedByPerson")
);

export const AutoAssignColumn = dynamic(
  () => import("./Modals/commands/autoAssignColumn")
);

export const ConfirmModal = dynamic(
  () => import("@/components/Modals/Common Modals/ConfirmActionModal")
);

export const SubtaskSettings = dynamic(
  () => import("./Modals/SubTaskSettings/SubTaskSettings")
);

export const ManageViews = dynamic(
  () => import("./Modals/ViewModals/ManageViewsModals")
);

export const ViewsForBoard = dynamic(
  () => import("./Modals/ViewModals/ViewsForBoardModal")
);

export const ShareTaskModal = dynamic(() => import("./Modals/ShareTaskModal"));

export const RenameTaskModal = dynamic(() => import("./Modals/RenameTask.modal"));

export const FeedbackModal = dynamic(() => import("./Modals/Feedback/FeedbackModal"));

export const TaskRelationPicker = dynamic(
  () => import("./Modals/TaskRelationPicker/TaskRelationPicker")
);

export const TableColumnsPicker = dynamic(
  () => import("./PageComponents/Kanban/TableView/TableColumnsPicker")
);

export const SwipeUnread = dynamic(() => import("./Modals/SwipeUnread/SwipeUnread"), {
  ssr: false,
});

export const CreateCustomFieldModal = dynamic(
  () => import("./Modals/CustomField/CreateCustomFieldModal")
);

export const ManageCustomFieldsModal = dynamic(
  () => import("./Modals/CustomField/ManageCustomFieldsModal")
);

export const SmartSplitModal = dynamic(
  () => import("./Modals/ViewModals/SmartSplitModal")
);

export const TaskDescriptionHistoryModal = dynamic(
  () => import("./Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal")
);
