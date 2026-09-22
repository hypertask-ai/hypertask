import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  AGENT_CHAT_PARKED_REPLY_FLAG,
  AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
} from "@/lib/agentRuns/model";

import {
  AGENT_CHAT_BRIEF_FLAG,
  AGENT_CHAT_SKILLS_FLAG,
  AGENT_CHAT_TICKET_CONFIRM_FLAG,
  AUTO_TASK_DESCRIPTIONS_FLAG,
  HTPR_6157_AUTO_DESCRIPTION_FLAG,
  COLUMN_ALL_VIEWS_FLAG,
  CORE_ACTIONS_SMOKE_FLAG,
  HEIC_ATTACHMENTS_FLAG,
  HTPR_6278_CHAT_TURN_FAILURE_FLAG,
  AGENT_VISIBILITY_FLAG,
  FEATURE_FLAG_DETAILS_FLAG,
  FIGMA_CONNECT_FLAG,
  GOOGLE_CALENDAR_FLAG,
  FLAG_REMOVAL_COUNTDOWN_FLAG,
  CONFIRMED_PROPOSAL_HEADING_FLAG,
  LAZY_EMOJI_LIST_FLAG,
  LOCAL_WRITING_ASSISTANCE_FLAG,
  FLAG_SHIP_DATE_CLUSTER_FLAG,
  FLAG_SORT_FILTER_FLAG,
  FLAG_TICKET_TITLE_FLAG,
  INBOX_ARCHIVE_CLUSTER_FLAG,
  PAGE_MENTIONS_FLAG,
  SHORTCUT_NUDGES_FLAG,
  SHARED_AGENT_CHAT_FLAG,
  MANAGER_LOOP_ACTIVITY_FLAG,
  MY_TASKS_PRIORITY_FILTER_FLAG,
  HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
  HTPR_4857_ADD_TO_SLACK_FLAG,
  HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG,
  HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
  HTPR_6320_AI_OBSERVABILITY_FLAG,
  HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
  HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG,
  POSTHOG_ERROR_ALERT_FLAG,
  SCOPED_BOARD_REFETCH_FLAG,
  MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG,
  MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  HTPR_6372_SEARCH_RANKING_FLAG,
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
  HTPR_6427_ROW_SHORTCUTS_FLAG,
  HTPR_6514_COMMENT_LONG_PRESS_FLAG,
  HTPR_6516_AGENT_ATTRIBUTION_FLAG,
  HTPR_6512_SEED_TEAM_AGENT_FLAG,
  HTPR_6533_MCP_CLIENT_EVAL_FLAG,
  HTPR_6532_STATELESS_MCP_FLAG,
  HTPR_6530_MCP_LIST_QUERY_FLAG,
  HTPR_6531_DEFERRED_MCP_TOOLS_FLAG,
  HTPR_6473_GET_AGENT_FLAG,
  HTPR_6470_PROJECT_DELETE_FLAG,
  HTPR_6536_QA_LOGIN_FLAG,
  HTPR_6551_QUIET_RUN_ACTIVITY_FLAG,
  HTPR_6555_IDLE_COMMENT_MIC_FLAG,
  HTPR_6553_AGENT_CHAT_POLLING_FLAG,
  HTPR_6554_LIGHT_COMMENT_SEPARATION_FLAG,
  HTPR_6557_AGENT_ROOMS_FLAG,
  HTPR_6559_KEEP_DIRECT_TASK_OPEN_FLAG,
  HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG,
  HTPR_6561_DESCRIPTION_STRUCTURE_FLAG,
  HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
} from "@/lib/flags/keys";

// Re-exported so server code keeps importing keys from here. Client components must
// import "@/lib/flags/keys" directly: this module reaches ioredis through the auth
// stack and cannot enter a browser bundle.
export * from "@/lib/flags/keys";

export const FEATURE_FLAG_OWNER_USER_ID = 6;
const FEATURE_FLAG_OWNER = {
  userId: FEATURE_FLAG_OWNER_USER_ID,
  email: "valentin.yeo@gmail.com",
} as const;
export const FEATURE_FLAG_QA_USER_ID = 985;
const FEATURE_FLAG_QA_USER = {
  userId: FEATURE_FLAG_QA_USER_ID,
  email: "valentin@hypertask.ai",
} as const;

// Keep the stored rows through the rollback window: older deployments still need the
// factory flag OFF and the shallow board switch ON. Neither can be changed here.
const RETIRED_FEATURE_FLAG_KEYS = new Set(["hyfa-43-factory-owner-preview", "htpr-6072-shallow-board-switch"]);

const FEATURE_FLAG_DEFINITIONS = [
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
    key: HTPR_6561_DESCRIPTION_STRUCTURE_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Preserves description headings, paragraphs, lists, and bold text when AI Chat edits a task, and stores bare API text as editor paragraphs.",
  },
  {
    key: HTPR_6554_LIGHT_COMMENT_SEPARATION_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Adds a quiet outline around posted comments in the Porcelain theme so adjacent comments stay distinct on phone and desktop.",
  },
  {
    key: HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Focuses mobile task creation on one description box, with collapsed title and properties plus raw and Task Writer save actions.",
  },
  {
    key: HTPR_6559_KEEP_DIRECT_TASK_OPEN_FLAG,
    shippedOn: "2026-09-18",
    description:
      "Keeps a task open after Ctrl or Command plus Enter unless it was opened through the Inbox cycle.",
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
    key: HTPR_6530_MCP_LIST_QUERY_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Lets MCP list and search tools take query, filter, sort, fields, limit, and cursor so one call can return only the rows and columns the client asked for.",
  },
  {
    key: HTPR_6473_GET_AGENT_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Lets hypertask agents get load one owned agent's mission text, boards, created time, and revoked state.",
  },
  {
    key: HTPR_6531_DEFERRED_MCP_TOOLS_FLAG,
    shippedOn: "2026-09-16",
    description:
      "MCP tools/list sends one short line per tool on connect. Full schemas load through hypertask_describe_tool, and hypertask_search_tools finds a tool by name.",
  },
  {
    key: HTPR_6532_STATELESS_MCP_FLAG,
    shippedOn: "2026-09-16",
    description:
      "Serves MCP over stateless Streamable HTTP: each request carries its own bearer token, session ids are ignored, and any server instance can answer any call.",
  },
  {
    key: HTPR_6512_SEED_TEAM_AGENT_FLAG,
    shippedOn: "2026-09-16",
    description:
      "When Owner or QA opens Agent Chat or lists a team that has no live agent they can see, seed a Hyper AI agent on a board of that team so the roster is not empty.",
  },
  {
    key: HTPR_6514_COMMENT_LONG_PRESS_FLAG,
    shippedOn: "2026-09-15",
    description:
      "On a phone, press and hold a comment to open the Command Center with comment actions at the top and Edit first. Swipe on a comment is off so it does not fight the task swipe.",
  },
  {
    key: HTPR_6427_ROW_SHORTCUTS_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Lets the selected table or My Tasks row use the same task property shortcuts as a Kanban card without opening the task.",
  },
  {
    key: HTPR_6320_AI_OBSERVABILITY_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Records every AI Chat turn in PostHog AI observability (user, model, tokens, time taken, and failures). No chat text is stored.",
  },
  {
    key: HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG,
    shippedOn: "2026-09-09",
    description:
      "In time reports, plain board members see only their own logged time; board owners and admins still see everyone's entries and keep the user filter.",
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
    key: AGENT_VISIBILITY_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Lets the CLI and MCP change an agent's visibility between PRIVATE and TEAM, like the web dashboard already can.",
  },
  {
    key: SHARED_AGENT_CHAT_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shares one agent conversation across authorized teammates, with private unread position and drafts for each person.",
  },
  {
    key: HEIC_ATTACHMENTS_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Shows a HEIC, HEIF or TIFF attachment as a named file you can download, instead of the broken-image icon a browser paints when it cannot decode the format.",
  },
  {
    key: CORE_ACTIONS_SMOKE_FLAG,
    shippedOn: "2026-09-08",
    description:
      "Runs the logged-in core-action production check and restores its isolated fixture after each run.",
  },
  {
    key: AGENT_CHAT_SKILLS_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Lets people import skills from GitHub and invoke installed skills in Agent Chat with /slug.",
  },
  {
    key: "htpr-5913-consistent-comment-shortcuts",
    shippedOn: "2026-09-04",
    description:
      "Makes comment shortcuts consistent: Ctrl+Enter sends and moves on, while Ctrl+Shift+Enter sends and stays.",
  },
  {
    key: "htpr-5992-mobile-all-tasks",
    shippedOn: "2026-09-04",
    description: "Shows the redesigned All Tasks view on mobile devices.",
  },
  {
    key: "htpr-5993-optimistic-task-uploads",
    shippedOn: "2026-09-04",
    description: "Saves new tasks immediately while their attachments continue uploading.",
  },
  {
    key: AGENT_CHAT_TICKET_CONFIRM_FLAG,
    shippedOn: "2026-09-05",
    description: "Requires a confirmed board ticket before Agent Chat can start side-effecting work.",
  },
  {
    key: "htpr-6091-feature-flags",
    shippedOn: "2026-09-04",
    description:
      "Registers the feature flag controls themselves; the owner-only admin page stays available in every mode.",
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
    key: "htpr-6118-comment-reactions-api",
    shippedOn: "2026-09-04",
    description: "Lets agents add and remove emoji reactions on comments through the API and CLI.",
  },
  {
    key: "htpr-6122-agent-run-activities",
    shippedOn: "2026-09-04",
    description: "Enables typed thought, action, response, error, and question updates for agent runs.",
  },
  {
    key: "htpr-6123-add-typescript-agent-sdk",
    shippedOn: "2026-09-05",
    description: "Allows the TypeScript Agent SDK to read and update agent runs.",
  },
  {
    key: "htpr-6124-agent-dev-loop",
    shippedOn: "2026-09-05",
    description:
      "Lets an agent author replay a recorded run into a handler running on their own machine.",
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
    key: FEATURE_FLAG_DETAILS_FLAG,
    shippedOn: "2026-09-04",
    description: "Shows a plain-language description and ticket link for every feature flag.",
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
    key: HTPR_6157_AUTO_DESCRIPTION_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Shows automatic Task Writer drafts in the desktop create-task modal after a title pause.",
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
    key: FLAG_TICKET_TITLE_FLAG,
    shippedOn: "2026-09-05",
    description: "Shows the linked ticket's title as the primary label on the flags admin page.",
  },
  {
    key: FLAG_SORT_FILTER_FLAG,
    shippedOn: "2026-09-05",
    description:
      "Sorts and clusters the feature flags page by release date, with an audience filter.",
  },
  {
    key: FLAG_SHIP_DATE_CLUSTER_FLAG,
    shippedOn: "2026-09-06",
    description: "Groups the feature flags page by the day each flag first reached production.",
  },
  {
    key: AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Lets people stop stuck Agent Chat turns and ends unanswered turns after five minutes.",
  },
  {
    key: AGENT_CHAT_PARKED_REPLY_FLAG,
    shippedOn: "2026-09-09",
    description:
      "Replies in the thread with one line saying an agent is parked when no runtime is connected to its chat, instead of leaving the message unanswered.",
  },
  {
    key: PAGE_MENTIONS_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Offers the board's canvas pages in the @ menu, so a comment or description can link a page like it links a task.",
  },
  {
    key: INBOX_ARCHIVE_CLUSTER_FLAG,
    shippedOn: "2026-09-06",
    description:
      "Adds Ctrl+K entries for the five biggest ticket piles in the inbox, and names the row archive action after what it already does.",
  },
  {
    key: COLUMN_ALL_VIEWS_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Adds Show in all views and Hide in all views to the column editor, so one column's visibility changes across every saved view at once.",
  },
  {
    key: FLAG_REMOVAL_COUNTDOWN_FLAG,
    shippedOn: "2026-09-07",
    description:
      "Counts down the 14 days before an Everyone flag is removed from the code, with a Keep switch that stops it. Set this flag itself to Everyone to let the daily sweep file the removal tickets.",
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
    key: SCOPED_BOARD_REFETCH_FLAG,
    shippedOn: "2026-09-12",
    description:
      "On a live board change, reloads only the board that changed instead of every board in the account, so updates appear with one request. Other boards' names still refresh when the tab reconnects or you move between boards.",
  },
  {
    key: MY_TASKS_SHORTCUTS_WIDTH_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Enables global shortcuts on My Tasks, remembers the selected board in the URL, and uses the full available page width.",
  },
  {
    key: HTPR_6372_SEARCH_RANKING_FLAG,
    shippedOn: "2026-09-14",
    description:
      "Hides search results that do not contain every word you typed, and when you open search from a board, shows that board's matches first.",
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
] as const satisfies readonly { key: string; description: string; shippedOn: string }[];

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

export type FeatureFlagRow = {
  key: string;
  mode: FeatureFlagMode;
  updatedAt: Date | null;
  releasedAt: Date | null;
  keep: boolean;
  removalTaskId: number | null;
  shippedOn: string | null;
  description: string;
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
  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === row.key);
  const ticketNumber = FEATURE_FLAG_KEY_TICKET_NUMBER.exec(row.key)?.[1];
  return {
    ...row,
    description: definition?.description ?? LEGACY_FEATURE_FLAG_DESCRIPTION,
    shippedOn: definition?.shippedOn ?? null,
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

// HTPR-6192: a flag with no stored row is on for the owner and the QA account, never owner-only,
// so the QA agent can verify a feature before Valentin looks at it. Choosing Only me stays possible,
// but it has to be set on the admin page on purpose.
const DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";

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
  const mode = row?.mode ?? DEFAULT_FEATURE_FLAG_MODE;
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
  const mode = row?.mode ?? DEFAULT_FEATURE_FLAG_MODE;
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
        { key, mode: DEFAULT_FEATURE_FLAG_MODE, updatedAt: null, releasedAt: null, keep: false, removalTaskId: null },
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
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      featureFlagModeEnabled(row.mode, isOwner, isQa),
    ]),
  );
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
      create: { key, mode: DEFAULT_FEATURE_FLAG_MODE, keep },
      update: { keep },
      select: FEATURE_FLAG_ROW_SELECT,
    }),
    loadFeatureFlagTicketTitles([key]),
  ]);
  return withFeatureFlagMetadata(row, ticketTitleByNumber);
}
