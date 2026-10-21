import KeyboardShortcuts from "@/components/sidebars/keyboardShortcuts";

export const generalConfig = {
  hyperAiId: 332,
  defaultNotificationPreference: "direct",
  defaultPhotoURL: "https://files.hypertask.app/tasks/attachments/1757584422625image.png",
};
 
export const DIV_ID_CONSTANTS = {
  inviteTeamButton: "invite-team-button",
  bodyLayout: "body-layout",
  descriptionContainerCreateTaskModal: "description-container-create-task-modal",
  titleInputModal: "title-input-modal",
  aiMentionList: "ai-mention-list",
  keyboardShortcuts: "keyboard-shortcut-container"
} as const;

export const INPUT_ID_CONSTANTS = {
  aiChatInput: "ai-chat-input",
  KeyboardShortcuts: 'keyboard-shortcuts-input'
} as const


export const CLASS_NAME_CONSTANTS = {
  createNewTaskButton: "create-new-task-button",
  sectionContainer: "section-container",
  inviteTeamButton: "invite-team-button",
  body:"body",
  inboxButton: "inbox-button",
  BOTTOM_HTC: "bottom-htc"
} as const;

export const TOUR_TARGET_CONSTANTS = {
  createNewTaskButton: `.${CLASS_NAME_CONSTANTS.createNewTaskButton}`,
  sectionContainer: `.${CLASS_NAME_CONSTANTS.sectionContainer}`,
  inviteTeamButton: `.${CLASS_NAME_CONSTANTS.inviteTeamButton}`,
  body:`.${CLASS_NAME_CONSTANTS.body}`,
  inboxButton:`.${CLASS_NAME_CONSTANTS.inboxButton}`,
  BOTTOM_HTC:`.${CLASS_NAME_CONSTANTS.BOTTOM_HTC}`,
  createTaskDescription: '#create-task-tiptap-description',
  createTaskModal: '#create-task-modal',
  descriptionContainerCreateTaskModal: `#${DIV_ID_CONSTANTS.descriptionContainerCreateTaskModal}`,
  titleInputModal: `#${DIV_ID_CONSTANTS.titleInputModal}`,
} as const;

export const MOBILE_TARGET =
  "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center";

export const TOUCH_HALO =
  "before:absolute before:-inset-y-1.5 before:-inset-x-1 before:content-['']";

export const TOUCH_HALO_X = "before:absolute before:-inset-x-1.5 before:inset-y-0 before:content-['']";
