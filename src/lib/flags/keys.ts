/**
 * Feature flag keys, and nothing else.
 *
 * `@/lib/flags` reaches getSessionUser -> betterAuth -> ioredis, so a client
 * component importing a key from there drags a Node-only TLS socket into the
 * browser bundle and the production build dies on `Can't resolve 'tls'`
 * (HTPR-6160). Client components import keys from here; the server keeps
 * importing them through `@/lib/flags`, which re-exports this file.
 */

export const FEATURE_FLAG_DETAILS_FLAG = "htpr-6133-feature-flag-details";
export const AGENT_CHAT_BRIEF_FLAG = "htpr-6155-chat-agent-brief";
export const AGENT_CHAT_SKILLS_FLAG = "htpr-6035-agent-chat-skills";
export const AGENT_CHAT_TICKET_CONFIRM_FLAG = "htpr-6006-chat-confirm-ticket";
export const AUTO_TASK_DESCRIPTIONS_FLAG = "htpr-6177-auto-task-descriptions";
export const FLAG_TICKET_TITLE_FLAG = "htpr-6176-flag-ticket-title";
export const FLAG_SORT_FILTER_FLAG = "htpr-6179-flag-sort-filter";
export const INBOX_ARCHIVE_CLUSTER_FLAG = "htpr-6160-inbox-archive-cluster";
export const FLAG_SHIP_DATE_CLUSTER_FLAG = "htpr-6191-flag-ship-date-clusters";
export const FIGMA_CONNECT_FLAG = "htpr-6136-figma-connect";
export const PAGE_MENTIONS_FLAG = "htpr-5898-page-mentions";
export const COLUMN_ALL_VIEWS_FLAG = "htpr-5937-show-column-in-all-views";
export const FLAG_REMOVAL_COUNTDOWN_FLAG = "htpr-6193-flag-removal-countdown";
export const SHORTCUT_NUDGES_FLAG = "htpr-5906-shortcut-nudges";
export const CONFIRMED_PROPOSAL_HEADING_FLAG = "htpr-6197-confirmed-proposal-heading";
export const MANAGER_LOOP_ACTIVITY_FLAG = "htpr-6243-manager-loop-activity";
export const LAZY_EMOJI_LIST_FLAG = "htpr-6059-lazy-emoji-list";
export const CORE_ACTIONS_SMOKE_FLAG = "htpr-6236-core-actions-smoke";
export const HEIC_ATTACHMENTS_FLAG = "htpr-6254-heic-heif-attachments";
export const TEAM_SCOPED_MANAGEMENT_KEYS_FLAG =
  "htpr-4540-team-scoped-management-keys";
