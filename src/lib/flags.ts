import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG } from "@/lib/agentRuns/model";

import {
  HTPR_7010_HAIKU_5_5_FLAG,
  HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG,
  HTPR_6997_NEW_TASK_WINDOW_VIEW_CONTEXT_FLAG,
  HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG,
  HTPR_7002_INBOX_E_FIRST_PRESS_FLAG,
  HTPR_6970_PHONE_NEW_TASK_TITLE_FLAG,
  HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG,
  HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG,
  HTPR_6950_TOOLTIP_TOP_LAYER_FLAG,
  HTPR_6962_KEEP_ASSIGNEE_FLAG,
  HTPR_6972_SUBTASK_LINK_FLAG,
  HTPR_6991_BACK_FIRST_OPEN_FLAG,
  HTPR_7000_INBOX_NEXT_OPEN_FLAG,
  HTPR_7003_BOARD_BACK_FLAG,
  HTPR_7004_NO_LOADING_FLASH_FLAG,
  HTPR_7008_PHONE_FIRST_PAINT_FLAG,
  HTPR_7001_INBOX_NEXT_CACHED_FLAG,
  HTPR_6978_SIZE_LABEL_CLICK_FLAG,
  HTPR_6934_SERVER_FIRST_SCREEN_FLAG,
  HTPR_6923_APP_ROUTER_WRITES_FLAG,
  HTPR_6925_TYPED_API_CLIENT_FLAG,
  HTPR_6967_TYPED_TASK_READS_FLAG,
  HTPR_6975_TYPED_WRITES_FLAG,
  HTPR_6979_TYPED_WRITES_FLAG,
  HTPR_6980_INSTANT_COLUMN_DELETE_FLAG,
  HTPR_6985_DELETE_VIEW_ONCE_FLAG,
  HTPR_6989_BULK_ARCHIVE_UNDO_FLAG,
  HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG,
  HTPR_6994_SEARCH_ESC_LEAVES_FLAG,
  HTPR_6998_BOARD_SCROLL_RESTORE_FLAG,
  HTPR_6924_REST_COMPAT_FLAG,
  HTPR_6929_COMPOSE_TASK_WRITER_FLAG,
  HTPR_6937_NEW_TASK_WINDOW_FLAG,
  HTPR_6951_TASK_WRITING_PROGRESS_FLAG,
  HTPR_6752_INSTANT_TICKET_OPEN_FLAG,
  HTPR_6873_QUICK_ENTRY_GROW_FLAG,
  HTPR_6892_CMDK_VERSION_FLAG,
  HTPR_6899_STABLE_LAYOUT_FLAG,
  HTPR_6902_N_QUICK_ADD_FLAG,
  HTPR_6914_SHIFT_C_QUICK_ADD_FLAG,
  AGENT_CHAT_BRIEF_FLAG,
  AGENT_CHAT_TICKET_CONFIRM_FLAG,
  AUTO_TASK_DESCRIPTIONS_FLAG,
  COLUMN_ALL_VIEWS_FLAG,
  HTPR_6278_CHAT_TURN_FAILURE_FLAG,
  FIGMA_CONNECT_FLAG,
  GOOGLE_CALENDAR_FLAG,
  CONFIRMED_PROPOSAL_HEADING_FLAG,
  LAZY_EMOJI_LIST_FLAG,
  LOCAL_WRITING_ASSISTANCE_FLAG,
  PAGE_MENTIONS_FLAG,
  SHORTCUT_NUDGES_FLAG,
  SHARED_AGENT_CHAT_FLAG,
  MANAGER_LOOP_ACTIVITY_FLAG,
  HTPR_6354_AI_CHAT_ALERTS_FLAG,
  MY_TASKS_PRIORITY_FILTER_FLAG,
  HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
  HTPR_4857_ADD_TO_SLACK_FLAG,
  HTPR_6921_SLACK_MARKETPLACE_FLAG,
  HTPR_6817_SLACK_APP_FLAG,
  HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG,
  HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
  HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
  HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG,
  HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG,
  HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG,
  HTPR_6872_PAGE_IMAGE_GALLERY_FLAG,
  HTPR_6868_TICKET_PREFIX_FLAG,
  HTPR_6662_AGENT_LOG_NAME_FLAG,
  POSTHOG_ERROR_ALERT_FLAG,
  MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG,
  MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  HTPR_6372_SEARCH_RANKING_FLAG,
  HTPR_6369_SEARCH_OPERATORS_FLAG,
  HTPR_6370_SEARCH_CHIPS_FLAG,
  HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG,
  HTPR_6865_SEARCH_LAYOUT_FLAG,
  HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG,
  HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG,
  HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG,
  HTPR_6936_ASK_AI_FULLSCREEN_FLAG,
  HTPR_6878_SEARCH_LABEL_SCOPE_FLAG,
  HTPR_6879_SEARCH_ESC_BACK_FLAG,
  HTPR_6881_SEARCH_FUZZY_PERSON_FLAG,
  HTPR_6885_SINGLE_UNDO_TOAST_FLAG,
  HTPR_6880_SEARCH_COMMENTER_FLAG,
  HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG,
  HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG,
  HTPR_6567_COMMAND_SCOPE_PICKER_FLAG,
  MY_TASKS_VIEWS_FLAG,
  MY_TASKS_BULK_SELECTION_FLAG,
  MY_TASKS_FILTER_PARITY_FLAG,
  MY_TASKS_TIME_GROUP_FLAG,
  MY_TASKS_TABLE_COLUMNS_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_LIVE_UPDATES_FLAG,
  MY_TASKS_QUICK_ADD_FLAG,
  MY_TASKS_SNOOZE_FLAG,
  MY_TASKS_OVERDUE_BADGES_FLAG,
  LUNA_FREE_PLAN_FLAG,
  HTPR_6427_ROW_SHORTCUTS_FLAG,
  HTPR_6516_AGENT_ATTRIBUTION_FLAG,
  HTPR_6512_SEED_TEAM_AGENT_FLAG,
  HTPR_6533_MCP_CLIENT_EVAL_FLAG,
  HTPR_6804_MCP_TOOLS_FLAG,
  HTPR_6926_MCP_ROUTE_WRAPPER_FLAG,
  HTPR_6927_MCP_V2_FLAG,
  HTPR_6470_PROJECT_DELETE_FLAG,
  HTPR_6536_QA_LOGIN_FLAG,
  HTPR_6551_QUIET_RUN_ACTIVITY_FLAG,
  HTPR_6555_IDLE_COMMENT_MIC_FLAG,
  HTPR_6553_AGENT_CHAT_POLLING_FLAG,
  HTPR_6557_AGENT_ROOMS_FLAG,
  HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG,
  HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
} from "@/lib/flags/keys";

// Re-exported so server code keeps importing keys from here. Client components must
// import "@/lib/flags/keys" directly: this module reaches ioredis through the auth
// stack and cannot enter a browser bundle.
export * from "@/lib/flags/keys";

export const FEATURE_FLAG_OWNER_USER_ID = 6;
// Board writes are never attributed to the owner alone.
export const FEATURE_FLAG_SWEEP_AGENT_ID = "85b985ac-afe8-41a3-a1ac-d9549a9310c7";
const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
export const FEATURE_FLAG_QA_USER_ID = 985;
const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

// Hide and reject retired flags without changing stored rows needed by older deployments.
export const RETIRED_FEATURE_FLAG_KEYS = new Set([
  "htpr-6160-inbox-archive-cluster",
  "htpr-6157-new-task-auto-description",
  "htpr-6166-scoped-board-refetch",
  "htpr-6322-agent-chat-parked-reply",
  "hyfa-43-factory-owner-preview",
  "htpr-6072-shallow-board-switch",
  "htpr-6254-heic-heif-attachments",
  "htpr-6236-core-actions-smoke",
  "htpr-6035-agent-chat-skills",
  "yper4-123-board-check",
  "yper4-160-flag-pages",
  "htpr-6091-feature-flags",
  "htpr-6133-feature-flag-details",
  "htpr-6176-flag-ticket-title",
  "htpr-6179-flag-sort-filter",
  "htpr-6191-flag-ship-date-clusters",
  "htpr-6193-flag-removal-countdown",
  "htpr-6800-flag-ticket-id",
  "htpr-6653-admin-team-comp",
  "htpr-6118-comment-reactions-api",
  "htpr-6123-add-typescript-agent-sdk",
  "htpr-6124-agent-dev-loop",
  "htpr-6348-agent-access-delegation",
  "htpr-6473-get-agent",
  "htpr-6530-mcp-list-query",
  "htpr-6531-deferred-mcp-tools",
  "htpr-6532-stateless-mcp",
  "htpr-6268-agent-visibility",
  "htpr-6320-ai-observability",
  "htpr-6673-capture-user-signed-up-in-posthog",
]);
// Old tabs read these infra flags as enabled; keep them until old deployments and tabs expire.
// Existing product retirement dates: remove htpr-6072 after 2026-10-06, htpr-6254 and htpr-6035 after 2026-10-16, htpr-6166 after 2026-10-20.
const RETIRED_CLIENT_FEATURE_FLAGS = {
  "htpr-6091-feature-flags": true,
  "htpr-6133-feature-flag-details": true,
  "htpr-6176-flag-ticket-title": true,
  "htpr-6179-flag-sort-filter": true,
  "htpr-6191-flag-ship-date-clusters": true,
  "htpr-6193-flag-removal-countdown": true,
  "htpr-6800-flag-ticket-id": true,
  "htpr-6653-admin-team-comp": true,
  "htpr-6118-comment-reactions-api": true,
  "htpr-6123-add-typescript-agent-sdk": true,
  "htpr-6124-agent-dev-loop": true,
  "htpr-6348-agent-access-delegation": true,
  "htpr-6473-get-agent": true,
  "htpr-6530-mcp-list-query": true,
  "htpr-6531-deferred-mcp-tools": true,
  "htpr-6532-stateless-mcp": true,
  "htpr-6268-agent-visibility": true,
  "htpr-6320-ai-observability": true,
  "htpr-6673-capture-user-signed-up-in-posthog": true,
  "htpr-6072-shallow-board-switch": true,
  "htpr-6254-heic-heif-attachments": true,
  "htpr-6035-agent-chat-skills": true,
  "htpr-6166-scoped-board-refetch": true,
} as const;

export type FeatureFlagKind = "feature" | "bugfix" | "improvement";
type FeatureFlagDefinition = {
  key: string;
  kind?: FeatureFlagKind;
  // HTPR-6926: mode used when no row is saved; wins over kind.
  defaultMode?: FeatureFlagMode;
  description: string;
  shippedOn: string;
  related?: readonly string[];
};

const FEATURE_FLAG_DEFINITIONS = [
  {
    key: HTPR_7010_HAIKU_5_5_FLAG,
    kind: "feature",
    defaultMode: "OWNER_AND_QA",
    shippedOn: "2026-10-08",
    description: "Makes Claude Haiku 5.5 the included default model and replaces saved Haiku 4.5 choices when enabled.",
  },
  {
    key: HTPR_7008_PHONE_FIRST_PAINT_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-08",
    description: "Defers automatic ticket editor, reactions, emoji and Firebase warming on phone board and inbox pages until user interaction.",
  },
  {
    key: HTPR_7001_INBOX_NEXT_CACHED_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Opens the next or previous Inbox ticket from saved data immediately, then refreshes it from the server.",
  },
  {
    key: HTPR_6989_BULK_ARCHIVE_UNDO_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Restores every selected inbox item after undoing a bulk archive, including after reload.",
  },
  {
    key: HTPR_6994_SEARCH_ESC_LEAVES_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Escape in search returns to the page you opened search from, even while the empty-box tips are showing.",
  },
  {
    key: HTPR_6998_BOARD_SCROLL_RESTORE_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Keeps the board and each column at their previous scroll positions when you return from search or another page.",
  },
  {
    key: HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Keeps ticket comments visible in narrow desktop windows by overlaying AI chat when its sidebar would squeeze the page.",
  },
  {
    key: HTPR_6985_DELETE_VIEW_ONCE_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Prevents repeated saved-view deletion while confirmation is pending and avoids errors for already-deleted views.",
  },
  {
    key: HTPR_6980_INSTANT_COLUMN_DELETE_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Removes a board column immediately after confirming deletion and restores it if deletion fails.",
  },
  {
    key: HTPR_6979_TYPED_WRITES_FLAG,
    shippedOn: "2026-10-06",
    description: "Validates section and notification writes with shared typed API contracts.",
  },
  {
    key: HTPR_6978_SIZE_LABEL_CLICK_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-06",
    description: "Makes clicking size label words in the task size picker select that size without an error.",
  },
  {
    key: HTPR_6975_TYPED_WRITES_FLAG,
    shippedOn: "2026-10-06",
    description: "Validates ticket property writes with shared typed API contracts.",
  },
  {
    key: HTPR_6967_TYPED_TASK_READS_FLAG,
    shippedOn: "2026-10-06",
    description: "Validates board, description history and cycle reads with shared typed API contracts.",
  },
  {
    key: HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG,
    shippedOn: "2026-10-06",
    description: "Returns missing or inaccessible skills projects as 404 without filing production error tickets.",
    kind: "bugfix",
  },
  {
    key: HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG,
    shippedOn: "2026-10-06",
    description: "Shows flag kinds and related changes, with a search field that stays visible while scrolling.",
    kind: "feature",
  },
  {
    key: HTPR_6923_APP_ROUTER_WRITES_FLAG,
    shippedOn: "2026-10-06",
    description: "Uses shared App-style handlers for legacy task writes while keeping the original URLs and responses.",
  },
  {
    key: HTPR_6991_BACK_FIRST_OPEN_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Clears the previous task immediately on Back or Forward before restoring cached detail or waiting for the destination route.",
  },
  {
    key: HTPR_7003_BOARD_BACK_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Keeps the previous ticket hidden on a quick Back from a board card until the board is ready to show.",
  },
  {
    key: HTPR_7004_NO_LOADING_FLASH_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-08",
    description: "Keeps an already-visible cached ticket on screen while retrying a failed background refresh instead of reloading into Loading after Back.",
  },
  {
    key: HTPR_7000_INBOX_NEXT_OPEN_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-07",
    description: "Shows the ticket opened by Inbox J or the next arrow instead of leaving the previous cached ticket over the new route.",
  },
  {
    key: HTPR_6972_SUBTASK_LINK_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-06",
    description: "Shows the linked task instead of keeping the parent's cached detail when navigating between tasks, including subtasks and parent links.",
  },
  {
    key: HTPR_6962_KEEP_ASSIGNEE_FLAG,
    kind: "bugfix",
    shippedOn: "2026-10-06",
    description: "Keeps a newly selected assignee visible after closing the picker when an older task refresh finishes.",
  },
  {
    key: HTPR_6925_TYPED_API_CLIENT_FLAG,
    shippedOn: "2026-10-06",
    description: "Validates skills and board memory settings reads with shared typed API contracts.",
  },
  {
    key: HTPR_6924_REST_COMPAT_FLAG,
    shippedOn: "2026-10-06",
    description: "Uses shared authentication and input readers for page REST routes while preserving legacy responses. Later compatibility migrations use the same switch.",
  },
  {
    key: HTPR_6950_TOOLTIP_TOP_LAYER_FLAG,
    shippedOn: "2026-10-05",
    description: "Keeps hover tooltips above other interface layers without being clipped or covered.",
  },
  {
    key: HTPR_6934_SERVER_FIRST_SCREEN_FLAG,
    shippedOn: "2026-10-04",
    description: "Prepares a shared board and inbox first-render contract. Server payloads are not enabled by this step.",
    kind: "improvement",
  },
  {
    key: HTPR_6951_TASK_WRITING_PROGRESS_FLAG,
    shippedOn: "2026-10-05",
    description: "Shows the Task Writer's current step in the New Task window instead of only a spinner. Requires the New Task window flag.",
    related: [HTPR_6937_NEW_TASK_WINDOW_FLAG, HTPR_6929_COMPOSE_TASK_WRITER_FLAG],
  },
  {
    key: HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG,
    shippedOn: "2026-10-07",
    description: "Quick add inherits the open board view labels, assignees, priority and size so the new card stays visible immediately.",
    kind: "bugfix",
  },
  {
    key: HTPR_6997_NEW_TASK_WINDOW_VIEW_CONTEXT_FLAG,
    shippedOn: "2026-10-07",
    description: "The New Task window opened with C or Ctrl+J inherits the view's assignees, priority and size without replacing caller values or user selections.",
    kind: "bugfix",
  },
  {
    key: HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG,
    shippedOn: "2026-10-07",
    description: "The Ctrl+J AI ticket writer inherits the open board view's labels, assignees, priority and size for new tickets on that board without replacing explicit values.",
    kind: "bugfix",
  },
  {
    key: HTPR_7002_INBOX_E_FIRST_PRESS_FLAG,
    shippedOn: "2026-10-07",
    description: "Inbox E archives the open ticket on the first press even before its full notification membership finishes loading.",
    kind: "bugfix",
  },
  {
    key: HTPR_6970_PHONE_NEW_TASK_TITLE_FLAG,
    shippedOn: "2026-10-06",
    description: "Restores the phone New Task title field's height and tap target when its collapsed section is expanded.",
    kind: "bugfix",
  },
  {
    key: HTPR_6937_NEW_TASK_WINDOW_FLAG,
    shippedOn: "2026-10-04",
    description: "Turns Compose into a larger New Task window with dictation and one Ctrl+J, filling an empty task when opened there. Requires the Compose task writer flag.",
    related: [HTPR_6929_COMPOSE_TASK_WRITER_FLAG],
  },
  {
    key: HTPR_6929_COMPOSE_TASK_WRITER_FLAG,
    shippedOn: "2026-10-04",
    description: "Adds Ctrl+J Compose to Commands: write a ticket from a note and images, then refine it in task-scoped AI chat.",
  },
  {
    key: HTPR_6926_MCP_ROUTE_WRAPPER_FLAG,
    shippedOn: "2026-10-06",
    description:
      "MCP API calls run through one shared route wrapper that checks the login once per call and keeps auth logs short. Switching takes up to 30 seconds to apply.",
    // Off until switched on: every agent token resolves to its human owner, so Owner + QA would
    // move all of Valentin's agents onto the new path at deploy (Infra Manager, 2026-10-06).
    defaultMode: "OFF",
  },
  {
    key: HTPR_6927_MCP_V2_FLAG,
    shippedOn: "2026-10-06",
    description: "Adds MCP tool safety hints, scope-aware legacy catalogs and a staged task update pipeline.",
  },
  {
    key: HTPR_6804_MCP_TOOLS_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Advertises consolidated MCP tools with action parameters, concise structured responses and actionable errors while retaining callable legacy names.",
    kind: "improvement",
  },
  {
    key: HTPR_6354_AI_CHAT_ALERTS_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Sends bounded AI Chat error-rate and latency incidents and recovery messages to Manager, with metadata-only monitoring and three retries.",
  },
  {
    key: HTPR_6892_CMDK_VERSION_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Shows the build loaded by this tab at the bottom of the desktop Ctrl+K command center, with its commit and local build time.",
  },
  {
    key: HTPR_6899_STABLE_LAYOUT_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Keeps cached tickets steady while comments, summaries, pages and properties load.",
    related: [HTPR_6752_INSTANT_TICKET_OPEN_FLAG],
  },
  {
    key: HTPR_6752_INSTANT_TICKET_OPEN_FLAG,
    shippedOn: "2026-10-02",
    description:
      "Shows a ticket immediately from authorized cached board, My Tasks, or Inbox data while its full detail refreshes in the background.",
  },
  {
    key: HTPR_6470_PROJECT_DELETE_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Lets board owners and admins permanently delete a board and its tasks through the Hypertask CLI after explicit confirmation.",
  },
  {
    key: HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Lets management keys be limited to one team while existing account-wide keys keep their current access.",
  },
  {
    key: HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Focuses mobile task creation on one description box, with collapsed title and properties plus raw and Task Writer save actions.",
  },
  {
    key: HTPR_6557_AGENT_ROOMS_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Adds one shared Agent Chat room per board, with named bot handoffs, a three-turn bot limit, Stop, and a visible daily turn budget.",
  },
  {
    key: HTPR_6555_IDLE_COMMENT_MIC_FLAG,
    shippedOn: "2026-09-17",
    description:
      "Shows the microphone on the closed task-detail comment bar so you can start dictating with one tap instead of tapping the text first.",
  },
  {
    key: HTPR_6553_AGENT_CHAT_POLLING_FLAG,
    shippedOn: "2026-09-17",
    description:
      "Lets a recently heartbeating agent runtime receive Agent Chat through polling when it has no webhook, and labels that chat as polling.",
  },
  {
    key: HTPR_6551_QUIET_RUN_ACTIVITY_FLAG,
    shippedOn: "2026-09-17",
    description:
      "Lets agent runtimes open and close ticket runs, and keeps passive run updates behind the task history toggle while questions stay visible.",
  },
  {
    key: HTPR_6536_QA_LOGIN_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Shows a QA-only email and password sign-in page so an outside test robot can open the real app behind login. The page and route exist only when the server has the QA login secrets.",
  },
  {
    key: HTPR_6533_MCP_CLIENT_EVAL_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Shows the MCP versus CLI eval table on the agents dashboard: success rate, tokens, wall time, and tool calls for Claude, Cursor, and Codex.",
  },
  {
    key: HTPR_6516_AGENT_ATTRIBUTION_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Shows the agent that made a comment, move, assignment or label change by the name it acted under, including after that agent is deleted. Without it a retired agent reads as Private agent.",
  },
  {
    key: HTPR_6512_SEED_TEAM_AGENT_FLAG,
    shippedOn: "2026-09-16",
    description:
      "When Owner or QA opens Agent Chat or lists a team that has no live agent they can see, seed a Hyper AI agent on a board of that team so the roster is not empty.",
  },
  {
    key: HTPR_6427_ROW_SHORTCUTS_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Lets the selected table or My Tasks row use the same task property shortcuts as a Kanban card without opening the task.",
  },
  {
    key: HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
    shippedOn: "2026-09-09",
    description:
      "In time reports, plain board members see only their own logged time; board owners and admins still see everyone's entries and keep the user filter.",
  },
  {
    key: HTPR_6817_SLACK_APP_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Completes Slack app parity with conversational task creation, assistant thread context and persistent per-person account disconnection. Existing Slack behavior remains unchanged when off.",
  },
  {
    key: HTPR_6921_SLACK_MARKETPLACE_FLAG,
    shippedOn: "2026-10-06",
    description:
      "Enables the public Slack support page and privacy, terms, and support links on Add to Slack. Anonymous visitors can access support only when set to Everyone.",
    kind: "improvement",
  },
  {
    key: HTPR_4857_ADD_TO_SLACK_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Enables the public /add-to-slack page and the Slack Marketplace install resume path (callback without signed state sends visitors to login, then Settings completes the link). Flip to Everyone before the Slack Marketplace submission.",
  },
  {
    key: LOCAL_WRITING_ASSISTANCE_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Capitalizes the first letter typed in a paragraph or after sentence punctuation when the browser does not do it itself.",
  },
  {
    key: MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG,
    shippedOn: "2026-09-10",
    description:
      "Sorting My Tasks by priority interleaves tasks from every board by priority level, instead of only reordering the tasks within each board's group.",
  },
  {
    key: HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
    shippedOn: "2026-09-08",
    description:
      "When you @name an agent in the AI chat, your message goes to that agent and its reply appears in the chat under its name, instead of the AI assistant answering for it.",
  },
  {
    key: HTPR_6278_CHAT_TURN_FAILURE_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Ends AI Chat turns that run out of time with a clear, saved failure message instead of a silent disconnect, and shows the server's real refusal instead of 'Connection lost'.",
  },
  {
    key: GOOGLE_CALENDAR_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Lets each user connect Google Calendar and keep assigned tasks with due dates in a dedicated Hypertask calendar.",
  },
  {
    key: SHARED_AGENT_CHAT_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shares one agent conversation across authorized teammates, with private unread position and drafts for each person.",
  },
  {
    key: "htpr-5913-consistent-comment-shortcuts",
    shippedOn: "2026-09-04",
    description:
      "Makes comment shortcuts consistent: Ctrl+Enter sends and moves on, while Ctrl+Shift+Enter sends and stays.",
  },
  {
    key: "htpr-5993-optimistic-task-uploads",
    kind: "improvement",
    shippedOn: "2026-09-04",
    description: "Saves new tasks immediately while their attachments continue uploading.",
  },
  {
    key: AGENT_CHAT_TICKET_CONFIRM_FLAG,
    shippedOn: "2026-09-05",
    description: "Requires a confirmed board ticket before Agent Chat can start side-effecting work.",
  },
  {
    key: "htpr-6094-agent-activity-rows",
    shippedOn: "2026-09-05",
    description: "Shows passive ticket progress between normal messages in Agent Chat.",
  },
  {
    key: "htpr-6112-copy-current-url",
    shippedOn: "2026-09-04",
    description: "Adds a Copy current URL action to the command menu.",
  },
  {
    key: "htpr-6115-agent-sdk",
    shippedOn: "2026-09-04",
    description: "Enables the shared Agent SDK run model and lifecycle endpoints.",
  },
  {
    key: "htpr-6122-agent-run-activities",
    shippedOn: "2026-09-04",
    description: "Enables typed thought, action, response, error, and question updates for agent runs.",
  },
  {
    key: "htpr-6129-mobile-agent-chat-viewport",
    shippedOn: "2026-09-04",
    description: "Keeps the full Agent Chat visible on mobile when the keyboard is open.",
  },
  {
    key: HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
    shippedOn: "2026-09-11",
    description:
      "Pins the Agent Chat composer on mobile, keeps one message scroller, shows the agent name in the top bar, and makes mic dictation use the agent's board.",
  },
  {
    key: HTPR_6885_SINGLE_UNDO_TOAST_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Shows one compact undo confirmation at the bottom left, replacing the previous card and fading after five seconds.",
    kind: "improvement",
  },
  {
    key: HTPR_6872_PAGE_IMAGE_GALLERY_FLAG,
    shippedOn: "2026-10-03",
    description:
      "Lets you click images on pages to view them full size, browse all page images, and download them in the ticket image gallery.",
  },
  {
    key: HTPR_6662_AGENT_LOG_NAME_FLAG,
    shippedOn: "2026-10-03",
    description: "Names the task history toggle Show agent log or Hide agent log in Ctrl+K and Toggle agent log in shortcut help.",
    kind: "improvement",
  },
  {
    key: HTPR_6868_TICKET_PREFIX_FLAG,
    shippedOn: "2026-10-03",
    description: "Lets board editors change ticket prefixes and choose a prefix when creating a board, while old IDs keep resolving.",
  },
  {
    key: HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG,
    shippedOn: "2026-10-03",
    description:
      "On mobile ticket pages (/page/...): hide the bottom bar, the same as the ticket screen.",
    kind: "improvement",
  },
  {
    key: HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG,
    shippedOn: "2026-10-03",
    description:
      "On mobile ticket pages: use the Settings-style back row, inset the title, and move page deletion into Commands.",
    kind: "improvement",
  },
  {
    key: HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG,
    shippedOn: "2026-09-14",
    description:
      "On mobile Agent Chat with an agent open: hide the app top bar and bottom nav, slim the header to back plus name, and reuse the AI chat TipTap composer, mic, and send.",
  },
  {
    key: "htpr-6287-agent-chat-roster-status",
    shippedOn: "2026-09-08",
    description: "Shows real per-agent status (active, idle, out of tokens, inactive) in the Agent Chat sidebar.",
  },
  {
    key: "htpr-6130-mobile-reminder-safe-area",
    shippedOn: "2026-09-04",
    description: "Keeps the mobile reminder time selector aligned and clear of bottom controls.",
  },
  {
    key: FIGMA_CONNECT_FLAG,
    shippedOn: "2026-09-06",
    description: "Lets each user connect a Figma account so linked frames render as previews.",
  },
  {
    key: "htpr-6141-ai-first-task-writer",
    shippedOn: "2026-09-04",
    description: "Opens the AI task writer from a column plus instead of the classic new-task form.",
  },
  {
    key: "htpr-6363-task-writer-research",
    shippedOn: "2026-09-11",
    description:
      "Restores board research in the AI task writer: related tickets, Done-style examples, open questions, and refine search from user text.",
  },
  {
    key: HTPR_6873_QUICK_ENTRY_GROW_FLAG,
    shippedOn: "2026-10-03",
    description: "Lets the board and table quick-entry box grow to eight lines, then scroll, with Create task and close buttons.",
    kind: "improvement",
    related: ["htpr-6175-quick-entry-cards"],
  },
  {
    key: HTPR_6902_N_QUICK_ADD_FLAG,
    shippedOn: "2026-10-03",
    description: "N opens the existing quick-entry box in the focused board or table column when quick-entry cards are enabled. C keeps opening the full editor.",
    related: ["htpr-6175-quick-entry-cards"],
  },
  {
    key: HTPR_6914_SHIFT_C_QUICK_ADD_FLAG,
    shippedOn: "2026-10-03",
    description: "Shift+C opens the quick add box like N",
    related: ["htpr-6175-quick-entry-cards"],
  },
  {
    key: "htpr-6175-quick-entry-cards",
    shippedOn: "2026-09-07",
    description: "Opens a small inline box for the column plus and the table's New task button so several cards can be entered one after another without the full editor.",
  },
  {
    key: AGENT_CHAT_BRIEF_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Gives Agent Chat a bounded snapshot of each agent's current and recent work.",
  },
  {
    key: AUTO_TASK_DESCRIPTIONS_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Drafts a task description from the title while you type, below an empty description.",
  },
  {
    key: AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Lets people stop stuck Agent Chat turns and ends unanswered turns after five minutes.",
  },
  {
    key: PAGE_MENTIONS_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Offers the board's canvas pages in the @ menu, so a comment or description can link a page like it links a task.",
  },
  {
    key: COLUMN_ALL_VIEWS_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Adds Show in all views and Hide in all views to the column editor, so one column's visibility changes across every saved view at once.",
  },
  {
    key: SHORTCUT_NUDGES_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows a shortcut tip on the next task page after three mouse-click notification archives in the inbox.",
  },
  {
    key: CONFIRMED_PROPOSAL_HEADING_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Head the Agent Chat proposal card 'Ticket created' once the ticket exists, instead of 'Ticket proposed, nothing done yet'.",
  },
  {
    key: MANAGER_LOOP_ACTIVITY_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows each scheduled Manager loop cycle in Agent Chat as a timestamped activity entry, including quiet and failed cycles.",
  },
  {
    key: LAZY_EMOJI_LIST_FLAG,
    kind: "improvement",
    shippedOn: "2026-09-08",
    description:
      "Downloads the editor's big emoji list only when you type a colon, instead of on every task open. Nothing visible changes.",
  },
  {
    key: POSTHOG_ERROR_ALERT_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Lets signed PostHog server errors alert the Manager and request a guarded rollback after a fresh release.",
  },
  {
    key: MY_TASKS_PRIORITY_FILTER_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Adds a priority filter to the My Tasks page. Picking one or more priority levels shows only those tasks; the choice resets when the page reloads.",
  },
  {
    key: HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Sorts the Agent Chat list by most recent chat message instead of a fixed order, and reorders live as messages arrive.",
  },
  {
    key: MY_TASKS_SHORTCUTS_WIDTH_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Enables global shortcuts on My Tasks, remembers the selected board in the URL, and uses the full available page width.",
  },
  {
    key: HTPR_6369_SEARCH_OPERATORS_FLAG,
    shippedOn: "2026-09-28",
    description:
      "Searches tasks by author, assignee, board, label, status, date and attachments using query operators, with suggestions for values.",
  },
  {
    key: HTPR_6370_SEARCH_CHIPS_FLAG,
    shippedOn: "2026-09-28",
    description: "Shows search operators as removable chips with people, board and label suggestions.",
    related: [HTPR_6369_SEARCH_OPERATORS_FLAG],
  },
  {
    key: HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG,
    shippedOn: "2026-10-01",
    description: "Completes search operators and values with keyboard suggestions, coloured filters, an active filter frame, search tips and highlighted result titles.",
    related: [HTPR_6369_SEARCH_OPERATORS_FLAG, HTPR_6370_SEARCH_CHIPS_FLAG],
  },
  {
    key: HTPR_6865_SEARCH_LAYOUT_FLAG,
    shippedOn: "2026-10-03",
    description: "Shows one aligned search suggestion list with recents, tips, people emails and grey value completion; searches only after acceptance or Enter. Requires search autocomplete, chips and operators.",
    related: [HTPR_6369_SEARCH_OPERATORS_FLAG, HTPR_6370_SEARCH_CHIPS_FLAG, HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG],
  },
  {
    key: HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG,
    shippedOn: "2026-10-03",
    description: "Shows why search results matched with inbox-style person highlights, label and board pills, safe text highlights and comment authors. Requires the search layout flag.",
    related: [HTPR_6865_SEARCH_LAYOUT_FLAG],
  },
  {
    key: HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG,
    shippedOn: "2026-10-03",
    description: "Gives selected search results and suggestions the inbox highlight: background edge to edge and the accent bar on the far left. Requires the search layout flag.",
    related: [HTPR_6865_SEARCH_LAYOUT_FLAG],
  },
  {
    key: HTPR_6936_ASK_AI_FULLSCREEN_FLAG,
    shippedOn: "2026-10-04",
    description: "Opens Ask AI from search in the existing full-screen AI chat, sends the question in a new conversation and keeps the search query for Back.",
  },
  {
    key: HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG,
    shippedOn: "2026-10-03",
    description: "Hides the search result tab row when every result comes from one board and there is no open or archived split.",
  },
  {
    key: HTPR_6878_SEARCH_LABEL_SCOPE_FLAG,
    shippedOn: "2026-10-03",
    description: "Scopes search label suggestions to picked boards, shows ticket counts and combines same-name labels across boards. Requires the search layout flag.",
    related: [HTPR_6865_SEARCH_LAYOUT_FLAG],
  },
  {
    key: HTPR_6879_SEARCH_ESC_BACK_FLAG,
    shippedOn: "2026-10-03",
    description: "Escape restores the previous search in this tab or recents and tips; empty searches never hide that list, and board chips omit the extra hash. Requires search layout.",
    related: [HTPR_6865_SEARCH_LAYOUT_FLAG],
  },
  {
    key: HTPR_6880_SEARCH_COMMENTER_FLAG,
    shippedOn: "2026-10-03",
    description: "Finds tasks commented on by a person and shows their newest matching comment; combines typed text with that person’s comments. The picker requires the search layout flag.",
    related: [HTPR_6865_SEARCH_LAYOUT_FLAG],
  },
  {
    key: HTPR_6881_SEARCH_FUZZY_PERSON_FLAG,
    shippedOn: "2026-10-03",
    description: "Typed author and assignee filters match all similar names or emails in accessible requested boards, ignoring case and accents; selected person IDs stay exact.",
  },
  {
    key: HTPR_6372_SEARCH_RANKING_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Hides search results that do not contain every word you typed, and when you open search from a board, shows that board's matches first.",
  },
  {
    key: HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG,
    shippedOn: "2026-10-04",
    description: "My Tasks uses icon-only controls, visible blue active states, remembered views and board tabs, and overdue tooltips.",
    kind: "improvement",
  },
  {
    key: HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG,
    shippedOn: "2026-10-04",
    description: "My Tasks reuses kanban Save view, sorting, and Ctrl+K pickers with matching checkmarks.",
    kind: "improvement",
  },
  {
    key: HTPR_6567_COMMAND_SCOPE_PICKER_FLAG,
    shippedOn: "2026-10-03",
    description: "My Tasks Scope uses the Ctrl+K assignee picker for boards; Columns and Show done move to Filters.",
  },
  {
    key: MY_TASKS_VIEWS_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Adds personal saved views to My Tasks with board, column, task filters, done visibility, and sorting.",
  },
  {
    key: MY_TASKS_BULK_SELECTION_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Adds Inbox-style multi-select on My Tasks with bulk archive, assign, label, and move to column.",
  },
  {
    key: MY_TASKS_FILTER_PARITY_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Opens the same Kanban filter menu on My Tasks, including match all/any, clear all, and the filters that were still missing.",
  },
  {
    key: MY_TASKS_TIME_GROUP_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Groups My Tasks by due time (Overdue, Today, This week, Later, No due date) by default, with board grouping still available per saved view.",
  },
  {
    key: MY_TASKS_TABLE_COLUMNS_FLAG,
    shippedOn: "2026-09-15",
    description:
      "Lets you choose which My Tasks table columns show, and saves that choice in the active My Tasks view.",
  },
  {
    key: MY_TASKS_SCOPES_FLAG,
    shippedOn: "2026-09-15",
    description:
      "Lets My Tasks show tasks you created, were mentioned in, or watch, not only tasks assigned to you. Multi-select, saved per view.",
  },
  {
    key: MY_TASKS_LIVE_UPDATES_FLAG,
    shippedOn: "2026-09-15",
    description:
      "Updates My Tasks rows live when another tab, the CLI, or an agent changes a task, without reloading the page.",
  },
  {
    key: MY_TASKS_QUICK_ADD_FLAG,
    shippedOn: "2026-09-15",
    description:
      "Adds a quick-add row at the top of My Tasks that creates a task on the view's default board, assigned to you.",
  },
  {
    key: MY_TASKS_SNOOZE_FLAG,
    shippedOn: "2026-09-15",
    description:
      "On My Tasks, H opens the existing Remind Me picker. The chosen date hides the row here and in Inbox until it returns to both.",
  },
  {
    key: LUNA_FREE_PLAN_FLAG,
    kind: "improvement",
    shippedOn: "2026-09-30",
    description:
      "Lets Free plans use GPT 6 Luna and makes it their default AI model. Without it Free plans default to Gemini 3.5 Flash Lite.",
  },
  {
    key: MY_TASKS_OVERDUE_BADGES_FLAG,
    shippedOn: "2026-09-15",
    description:
      "Shows a red overdue count next to each My Tasks view tab and board split tab. Hidden when the count is zero. Counts follow the filters that are on.",
  },
  // ponytail: `shippedOn` is the calendar day the key first reached production, written by hand
  // because git history is not readable at runtime. Backfilled with
  // `git log -S"<key>" --format=%cd --date=short production | tail -1`. An author adding a flag
  // writes the date they expect to merge, so it can be a day early if the pull request sits
  // overnight; run the same command after merging to correct it. Upgrade path if that ever
  // matters: generate this map from git at build time.
] as const satisfies readonly FeatureFlagDefinition[];

export const FEATURE_FLAG_KEYS = FEATURE_FLAG_DEFINITIONS.map(({ key }) => key);
// HTPR-6128 explicitly exempts this bootstrap mode: gating flag infrastructure by itself is circular.
export const FEATURE_FLAG_MODES = [
  "OWNER_ONLY",
  "OWNER_AND_QA",
  "EVERYONE",
  "OFF",
] as const;
export type FeatureFlagMode = PrismaFeatureFlagMode;

export class FeatureFlagInputError extends Error {}

type FeatureFlagDatabase = {
  featureFlag: Pick<PrismaClient["featureFlag"], "findUnique">;
  user: Pick<PrismaClient["user"], "findUnique">;
};

async function matchesFeatureFlagIdentity(
  userId: number,
  identity: { userId: number; email: string },
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  if (userId !== identity.userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email.trim().toLowerCase() === identity.email;
}

const isFeatureFlagOwnerUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_OWNER, db);

const isFeatureFlagQaUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_QA_USER, db);

export async function isFeatureFlagOwner(headers: Headers): Promise<boolean> {
  const session = await getSessionUser(headers);
  return session ? isFeatureFlagOwnerUser(session.userId) : false;
}

// Historical bug flags predate kind-based defaults. Classify them for display only:
// adding kind: "bugfix" to their definitions would release missing rows to Everyone.
const LEGACY_BUGFIX_DISPLAY_KINDS: Partial<Record<string, FeatureFlagKind>> = {
  [HTPR_6951_TASK_WRITING_PROGRESS_FLAG]: "bugfix",
  [HTPR_6553_AGENT_CHAT_POLLING_FLAG]: "bugfix",
  [HTPR_6516_AGENT_ATTRIBUTION_FLAG]: "bugfix",
  [HTPR_6512_SEED_TEAM_AGENT_FLAG]: "bugfix",
  [LOCAL_WRITING_ASSISTANCE_FLAG]: "bugfix",
  [HTPR_6278_CHAT_TURN_FAILURE_FLAG]: "bugfix",
  ["htpr-6112-copy-current-url"]: "bugfix",
  ["htpr-6129-mobile-agent-chat-viewport"]: "bugfix",
  [HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG]: "bugfix",
  ["htpr-6363-task-writer-research"]: "bugfix",
  [AUTO_TASK_DESCRIPTIONS_FLAG]: "bugfix",
  [SHORTCUT_NUDGES_FLAG]: "bugfix",
  [CONFIRMED_PROPOSAL_HEADING_FLAG]: "bugfix",
  [MY_TASKS_SHORTCUTS_WIDTH_FLAG]: "bugfix",
  [HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG]: "bugfix",
  [HTPR_6372_SEARCH_RANKING_FLAG]: "bugfix",
  ["htpr-6141-ai-first-task-writer"]: "bugfix",
  [AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG]: "bugfix",
};

export type FeatureFlagRow = {
  key: string;
  kind?: FeatureFlagKind;
  related?: readonly string[];
  mode: FeatureFlagMode;
  updatedAt: Date | null;
  releasedAt: Date | null;
  keep: boolean;
  removalTaskId: number | null;
  shippedOn: string | null;
  description: string;
  ticketId: string | null;
  ticketUrl: string | null;
  ticketTitle: string | null;
};

const FEATURE_FLAG_ROW_SELECT = {
  key: true,
  mode: true,
  updatedAt: true,
  releasedAt: true,
  keep: true,
  removalTaskId: true,
} as const;

export const FEATURE_FLAG_TICKET_PROJECT_ID = 15;
// Serialises the read-decide-write in setFeatureFlagMode. Without it two fast clicks can both read
// the old mode, and an OFF write landing after an EVERYONE write leaves EVERYONE on a stale date.
const FEATURE_FLAG_MODE_LOCK_NAMESPACE = 6193;
const FEATURE_FLAG_TICKET_BASE = "https://app.hypertask.ai/detail/project-15";
export const FEATURE_FLAG_ADMIN_URL = "https://app.hypertask.ai/admin/flags";
const LEGACY_FEATURE_FLAG_DESCRIPTION =
  "This older feature flag has no description in this version of the app.";
const FEATURE_FLAG_KEY_TICKET_NUMBER = /^htpr-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function withFeatureFlagMetadata(
  row: Pick<FeatureFlagRow, "key" | "mode" | "updatedAt" | "releasedAt" | "keep" | "removalTaskId">,
  ticketTitleByNumber: Map<number, string>,
): FeatureFlagRow {
  const definition: FeatureFlagDefinition | undefined = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);
  const ticketNumber = FEATURE_FLAG_KEY_TICKET_NUMBER.exec(row.key)?.[1];
  return {
    ...row,
    kind: definition?.kind ?? LEGACY_BUGFIX_DISPLAY_KINDS[row.key] ?? "feature",
    related: definition?.related ? [...(definition.related ?? [])] : undefined,
    description: definition?.description ?? LEGACY_FEATURE_FLAG_DESCRIPTION,
    shippedOn: definition?.shippedOn ?? null,
    ticketId: ticketNumber ? `HTPR-${ticketNumber}` : null,
    ticketUrl: ticketNumber ? `${FEATURE_FLAG_TICKET_BASE}/${ticketNumber}` : null,
    ticketTitle: ticketNumber ? (ticketTitleByNumber.get(Number(ticketNumber)) ?? null) : null,
  };
}

async function loadFeatureFlagTicketTitles(keys: readonly string[]): Promise<Map<number, string>> {
  const ticketNumbers = keys
    .map((key) => FEATURE_FLAG_KEY_TICKET_NUMBER.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  if (ticketNumbers.length === 0) return new Map();
  const tickets = await prisma.task.findMany({
    where: { projectId: FEATURE_FLAG_TICKET_PROJECT_ID, uniqueIndex: { in: ticketNumbers } },
    select: { uniqueIndex: true, title: true },
  });
  return new Map(tickets.map((ticket) => [ticket.uniqueIndex, ticket.title]));
}

export function featureFlagModeEnabled(
  mode: FeatureFlagMode,
  isOwner: boolean,
  isQa: boolean,
): boolean {
  if (mode === "EVERYONE") return true;
  if (mode === "OWNER_AND_QA") return isOwner || isQa;
  if (mode === "OWNER_ONLY") return isOwner;
  return false;
}

// HTPR-6192: a feature flag with no stored row is on for the owner and QA, never owner-only,
// so the QA agent can verify a feature before Valentin looks at it. Choosing Only me stays possible,
// but it has to be set on the admin page on purpose.
const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";
const DEFAULT_BUGFIX_FLAG_MODE: FeatureFlagMode = "EVERYONE";

export function defaultFeatureFlagMode(key: string): FeatureFlagMode {
  const definition: FeatureFlagDefinition | undefined = FEATURE_FLAG_DEFINITIONS.find(({ key: declaredKey }) => declaredKey === key);
  return definition?.defaultMode ?? (definition?.kind === "bugfix"
    ? DEFAULT_BUGFIX_FLAG_MODE
    : DEFAULT_FEATURE_FLAG_MODE);
}

/**
 * The user ids a flag can possibly be on for, or null when it is on for
 * everyone. A coarse prefilter only: isFeatureEnabled still decides per user.
 */
export async function featureFlagCandidateUserIds(
  key: string,
  db: FeatureFlagDatabase = prisma,
): Promise<number[] | null> {
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) return [];
  const row = await db.featureFlag.findUnique({ where: { key }, select: { mode: true } });
  const mode = row?.mode ?? defaultFeatureFlagMode(key);
  if (mode === "EVERYONE") return null;
  if (mode === "OFF") return [];
  return mode === "OWNER_AND_QA"
    ? [FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID]
    : [FEATURE_FLAG_OWNER_USER_ID];
}

export async function isFeatureEnabled(
  key: string,
  userId: number,
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) return false;
  const row = await db.featureFlag.findUnique({
    where: { key },
    select: { mode: true },
  });
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  if (!row && !declared) return false;
  const mode = row?.mode ?? defaultFeatureFlagMode(key);
  const includesOwner = mode === "OWNER_ONLY" || mode === "OWNER_AND_QA";
  return featureFlagModeEnabled(
    mode,
    includesOwner && (await isFeatureFlagOwnerUser(userId, db)),
    mode === "OWNER_AND_QA" && (await isFeatureFlagQaUser(userId, db)),
  );
}

export async function listFeatureFlagModes(
  options: { includeTicketTitles?: boolean } = {},
): Promise<FeatureFlagRow[]> {
  const stored = (
    await prisma.featureFlag.findMany({
      select: FEATURE_FLAG_ROW_SELECT,
      orderBy: { key: "asc" },
    })
  ).filter(({ key }) => !RETIRED_FEATURE_FLAG_KEYS.has(key));
  const ticketTitleByNumber = options.includeTicketTitles
    ? await loadFeatureFlagTicketTitles([
        ...new Set([...FEATURE_FLAG_KEYS, ...stored.map(({ key }) => key)]),
      ])
    : new Map<number, string>();
  const byKey = new Map<string, FeatureFlagRow>(
    FEATURE_FLAG_KEYS.map((key) => [
      key,
      withFeatureFlagMetadata(
        { key, mode: defaultFeatureFlagMode(key), updatedAt: null, releasedAt: null, keep: false, removalTaskId: null },
        ticketTitleByNumber,
      ),
    ]),
  );
  stored.forEach((row) => byKey.set(row.key, withFeatureFlagMetadata(row, ticketTitleByNumber)));
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function featureFlagsForUser(
  userId: number,
): Promise<Record<string, boolean>> {
  const rows = await listFeatureFlagModes();
  const isOwner = rows.some(
    (row) => row.mode === "OWNER_ONLY" || row.mode === "OWNER_AND_QA",
  )
    ? await isFeatureFlagOwnerUser(userId)
    : false;
  const isQa = rows.some((row) => row.mode === "OWNER_AND_QA")
    ? await isFeatureFlagQaUser(userId)
    : false;
  return {
    ...Object.fromEntries(
      rows.map((row) => [
        row.key,
        featureFlagModeEnabled(row.mode, isOwner, isQa),
      ]),
    ),
    ...RETIRED_CLIENT_FEATURE_FLAGS,
  };
}

export function validFeatureFlagKey(key: string): boolean {
  return key.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
}

export async function setFeatureFlagMode(
  key: string,
  mode: FeatureFlagMode,
): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key) || !FEATURE_FLAG_MODES.includes(mode)) {
    throw new FeatureFlagInputError("Invalid feature flag");
  }
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) {
    throw new FeatureFlagInputError("Unknown feature flag");
  }
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);

  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        CAST(${FEATURE_FLAG_MODE_LOCK_NAMESPACE} AS integer),
        hashtext(${key})
      )
    `;
    const stored = await tx.featureFlag.findUnique({
      where: { key },
      select: { key: true, mode: true, releasedAt: true },
    });
    if (!declared && !stored) throw new FeatureFlagInputError("Unknown feature flag");

    // HTPR-6193: entering EVERYONE restarts the 14-day removal countdown and unlinks the ticket
    // filed for the previous release. Re-filing is still suppressed while the old ticket is open
    // or Keep is on, both by the sweep. Staying on EVERYONE keeps the original date, so
    // re-pressing Everyone cannot extend the clock.
    const entersEveryone = mode === "EVERYONE" && (stored?.mode !== "EVERYONE" || !stored.releasedAt);
    const release = entersEveryone ? { releasedAt: new Date(), removalTaskId: null } : {};

    return tx.featureFlag.upsert({
      where: { key },
      create: { key, mode, ...release },
      update: { mode, ...release },
      select: FEATURE_FLAG_ROW_SELECT,
    });
  });
  return withFeatureFlagMetadata(row, await loadFeatureFlagTicketTitles([key]));
}

/**
 * Pauses or resumes removal for one flag. Keep never moves `releasedAt`, so turning it off
 * resumes the countdown from the original release date, as HTPR-6193 asks.
 */
export async function setFeatureFlagKeep(key: string, keep: boolean): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key)) throw new FeatureFlagInputError("Invalid feature flag");
  if (RETIRED_FEATURE_FLAG_KEYS.has(key)) throw new FeatureFlagInputError("Unknown feature flag");
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  const stored = await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } });
  if (!declared && !stored) throw new FeatureFlagInputError("Unknown feature flag");

  const [row, ticketTitleByNumber] = await Promise.all([
    prisma.featureFlag.upsert({
      where: { key },
      create: { key, mode: defaultFeatureFlagMode(key), keep },
      update: { keep },
      select: FEATURE_FLAG_ROW_SELECT,
    }),
    loadFeatureFlagTicketTitles([key]),
  ]);
  return withFeatureFlagMetadata(row, ticketTitleByNumber);
}
