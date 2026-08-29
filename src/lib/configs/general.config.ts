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

// Apple and Android both publish 44px as the minimum touch target. Mobile
// controls that are only a glyph reserve the target without growing the glyph
// (HTPR-5098).
export const MOBILE_TARGET =
  "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center";

// Grows a control's tap area past what it paints, without moving anything on
// screen. A 32px circle keeps its look and still answers a 44px thumb. Only
// works where neighbours are far enough apart that the halos cannot overlap
// (HTPR-5114).
//
// No `relative` in here on purpose: Tailwind emits `.relative` after
// `.absolute`, so bundling it would beat an `absolute` the caller already has
// and drop a floating button back into the flow. Callers that are not already
// positioned add `relative` themselves.
// Measured live: the share and archive circles sit 40px apart, so a symmetric
// 6px halo overlapped by 4px and a tap in the seam could archive instead of
// share. 6px vertically (nothing above or below) and 4px horizontally gives
// 44x40 with the neighbours exactly touching, never overlapping.
export const TOUCH_HALO =
  "before:absolute before:-inset-y-1.5 before:-inset-x-1 before:content-['']";

// Horizontal half of TOUCH_HALO, for controls stacked too closely to grow
// vertically without overlapping a neighbour (HTPR-5114).
export const TOUCH_HALO_X = "before:absolute before:-inset-x-1.5 before:inset-y-0 before:content-['']";
