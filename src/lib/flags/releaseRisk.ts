export const RELEASE_RISK_REQUIRED_FROM = "2026-10-11";

export type FeatureFlagReleaseRisk = {
  risk: "none" | "small" | "new";
  reason: string;
};

export const RELEASE_RISK_LABELS: Record<FeatureFlagReleaseRisk["risk"], string> = {
  none: "No visible change",
  small: "Small change",
  new: "New feature",
};
export const RELEASE_RISK_ORDER: FeatureFlagReleaseRisk["risk"][] = ["none", "small", "new"];

export const FEATURE_FLAG_RELEASE_RISKS: Partial<Record<string, FeatureFlagReleaseRisk>> = {
  "htpr-7056-ctrlj-split-tasks": {
    risk: "new",
    reason: "A Ctrl+J message that asks for several separate tasks creates one ticket per task and lists them all.",
  },
  "htpr-7020-tag-full-name": {
    risk: "small",
    reason: "Hovering a tag in ticket details shows its full name in the existing tooltip.",
  },
  "htpr-7050-ctrl-o-links": {
    risk: "small",
    reason: "The existing Ctrl+O menu lists saved ticket links and attachments that were previously missing.",
  },
  "htpr-7049-reload-after-image-chat": {
    risk: "small",
    reason: "The open ticket refreshes after AI chat edits it, including requests with image attachments.",
  },
  "htpr-7061-remind-without-inbox": {
    risk: "small",
    reason: "The existing Remind action brings a ticket back to the Inbox even when it had no Inbox item.",
  },
  "htpr-7058-flags-page-url-filters": {
    risk: "new",
    reason: "The flags page adds shareable type and release-risk filters to help decide what to release.",
  },
  "htpr-7037-shared-email-layout": {
    risk: "small",
    reason: "Agent connection and first-task emails use the existing onboarding email design.",
  },
  "htpr-7034-activation-analytics": {
    risk: "none",
    reason: "Records activation milestones for reporting without changing what users see.",
  },
  "htpr-6964-flags-page-type-search": {
    risk: "new",
    reason: "The flags page adds search, ticket-type badges and links to related changes.",
  },
  "htpr-6950-tooltip-top-layer": {
    risk: "small",
    reason: "Existing hover tips stay visible above other parts of the interface.",
  },
  "htpr-6934-server-first-screen": {
    risk: "none",
    reason: "Loads the existing board and inbox from server data without adding interface controls.",
  },
  "htpr-6951-task-writing-progress": {
    risk: "small",
    reason: "The New Task window shows the current writing step instead of only a spinner.",
  },
  "htpr-6937-new-task-window": {
    risk: "new",
    reason: "The New Task window adds dictation and a revised keyboard-driven task creation flow.",
  },
  "htpr-6929-compose-task-writer": {
    risk: "new",
    reason: "Adds a Compose flow that writes a ticket from notes and images, then opens AI refinement.",
  },
  "htpr-6354-ai-chat-alerts": {
    risk: "none",
    reason: "Monitors AI chat reliability and alerts the Manager without changing the app interface.",
  },
  "htpr-6899-stable-layout": {
    risk: "small",
    reason: "Ticket content keeps its position while comments and properties finish loading.",
  },
  "htpr-6470-project-delete": {
    risk: "none",
    reason: "Adds confirmed board deletion to the command-line tool without changing the app interface.",
  },
  "htpr-6542-team-scoped-management-keys": {
    risk: "new",
    reason: "Management key settings add a choice to limit a key to one team.",
  },
  "htpr-6556-mobile-description-first": {
    risk: "new",
    reason: "Mobile task creation adds a description-first flow with Task Writer and direct save choices.",
  },
  "htpr-6557-agent-rooms": {
    risk: "new",
    reason: "Adds a shared chat room on each board where people and agents can work together.",
  },
  "htpr-6555-idle-comment-mic": {
    risk: "new",
    reason: "Adds a microphone to the closed comment bar so dictation can start with one tap.",
  },
  "htpr-6551-quiet-run-activity": {
    risk: "small",
    reason: "Routine agent progress stays in task history while important questions remain visible.",
  },
  "htpr-6536-qa-login": {
    risk: "new",
    reason: "Adds a dedicated QA sign-in page for automated testing.",
  },
  "htpr-6533-mcp-client-eval": {
    risk: "new",
    reason: "The agents dashboard adds a table comparing command-line and MCP client evaluations.",
  },
  "htpr-6516-agent-attribution": {
    risk: "small",
    reason: "Comments and task history show the acting agent name instead of Private agent.",
  },
  "htpr-6512-seed-team-agent": {
    risk: "none",
    reason: "Creates a default agent for teams that have none without adding an interface control.",
  },
  "htpr-6427-row-shortcuts": {
    risk: "small",
    reason: "Existing table and My Tasks rows respond to task-property keyboard shortcuts.",
  },
  "htpr-6817-slack-app": {
    risk: "new",
    reason: "Adds conversational task creation and account connection flows to the official Slack app.",
  },
  "htpr-6921-slack-marketplace": {
    risk: "new",
    reason: "Adds a public Slack support page and support links to the installation flow.",
  },
  "htpr-4857-add-to-slack": {
    risk: "new",
    reason: "Adds a public Add to Slack page and resumes installation after sign-in.",
  },
  "htpr-5908-local-writing-assistance": {
    risk: "small",
    reason: "The existing editor capitalizes sentence starts when the browser does not.",
  },
  "htpr-6215-my-tasks-cross-board-priority-sort": {
    risk: "small",
    reason: "My Tasks priority sorting interleaves tasks from all boards by priority.",
  },
  "htpr-6284-agent-mention-routing": {
    risk: "small",
    reason: "Mentioning an agent in the existing AI chat sends the message to that agent.",
  },
  "htpr-3533-google-calendar": {
    risk: "new",
    reason: "Adds Google Calendar connection settings and task synchronization.",
  },
  "htpr-6002-shared-agent-chat": {
    risk: "new",
    reason: "Adds shared agent conversations that authorized teammates can use together.",
  },
  "htpr-6006-chat-confirm-ticket": {
    risk: "none",
    reason: "Adds stored ticket-confirmation safeguards for agent work without a new interface.",
  },
  "htpr-6094-agent-activity-rows": {
    risk: "new",
    reason: "Agent Chat adds progress rows between normal conversation messages.",
  },
  "htpr-6115-agent-sdk": {
    risk: "none",
    reason: "Adds a shared agent run model and developer endpoints without changing app screens.",
  },
  "htpr-6122-agent-run-activities": {
    risk: "none",
    reason: "Adds structured agent run updates for integrations without a new app control.",
  },
  "htpr-6407-mobile-agent-chat-layout": {
    risk: "small",
    reason: "Mobile Agent Chat keeps the composer pinned and uses one message scroller.",
  },
  "htpr-6872-page-image-gallery": {
    risk: "new",
    reason: "Page images open in a full-size gallery with browsing and download controls.",
  },
  "htpr-6868-ticket-prefix": {
    risk: "new",
    reason: "Board settings and board creation add ticket-prefix choices.",
  },
  "htpr-6476-mobile-agent-chat-fullscreen": {
    risk: "small",
    reason: "Mobile Agent Chat uses the existing AI composer in a full-screen layout.",
  },
  "htpr-6287-agent-chat-roster-status": {
    risk: "small",
    reason: "The existing Agent Chat roster shows each agent's actual activity and token status.",
  },
  "htpr-6141-ai-first-task-writer": {
    risk: "small",
    reason: "The column add button opens the AI task writer instead of the classic task form.",
  },
  "htpr-6155-chat-agent-brief": {
    risk: "none",
    reason: "Gives agents context about their current and recent work without adding interface controls.",
  },
  "htpr-6177-auto-task-descriptions": {
    risk: "new",
    reason: "Adds draft task descriptions below the title while a task is being written.",
  },
  "htpr-5906-shortcut-nudges": {
    risk: "new",
    reason: "Adds a keyboard shortcut tip after repeated mouse-based inbox actions.",
  },
  "htpr-6243-manager-loop-activity": {
    risk: "small",
    reason: "The existing Agent Chat activity feed records each scheduled Manager cycle.",
  },
  "htpr-6238-posthog-error-alert": {
    risk: "none",
    reason: "Routes server error alerts to the Manager and guards rollbacks without changing app screens.",
  },
  "htpr-6312-my-tasks-priority-filter": {
    risk: "new",
    reason: "My Tasks adds a filter for one or more priority levels.",
  },
  "htpr-6283-agent-chat-live-sort": {
    risk: "small",
    reason: "The existing Agent Chat roster reorders by the most recent message.",
  },
  "htpr-6421-my-tasks-shortcuts-width": {
    risk: "small",
    reason: "My Tasks supports global shortcuts, remembers the board tab and uses the available width.",
  },
  "htpr-6936-ask-ai-fullscreen": {
    risk: "small",
    reason: "Ask AI from search opens the existing full-screen chat and preserves the query for Back.",
  },
  "htpr-6938-my-tasks-icon-controls": {
    risk: "small",
    reason: "Existing My Tasks controls use icons, clearer active states and remembered views.",
  },
  "htpr-6422-my-tasks-views": {
    risk: "new",
    reason: "My Tasks adds personal saved views with filters and sorting.",
  },
  "htpr-6444-my-tasks-bulk-selection": {
    risk: "new",
    reason: "My Tasks adds multi-selection and bulk archive, assignment, label and move actions.",
  },
  "htpr-6447-my-tasks-filter-parity": {
    risk: "new",
    reason: "My Tasks adds the board filter menu and its full set of filter choices.",
  },
  "htpr-6455-my-tasks-time-group": {
    risk: "small",
    reason: "My Tasks groups tasks by due time by default instead of by board.",
  },
  "htpr-6456-my-tasks-table-columns": {
    risk: "new",
    reason: "My Tasks adds a column picker whose choices are saved with the view.",
  },
  "htpr-6457-my-tasks-scopes": {
    risk: "new",
    reason: "My Tasks adds choices for tasks created, mentioned or watched as well as assigned.",
  },
  "htpr-6458-my-tasks-live-updates": {
    risk: "small",
    reason: "Existing My Tasks rows update when a task changes elsewhere without a reload.",
  },
  "htpr-6460-my-tasks-quick-add": {
    risk: "new",
    reason: "My Tasks adds a quick-add row that creates tasks on the view default board.",
  },
  "htpr-6461-my-tasks-snooze": {
    risk: "new",
    reason: "My Tasks adds snoozing through the existing Remind Me date picker.",
  },
  "htpr-6459-my-tasks-overdue-badges": {
    risk: "new",
    reason: "My Tasks view and board tabs add a red count of overdue tasks.",
  },
};
