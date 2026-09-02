/**
 * Tool Metadata Configuration
 * 
 * Single source of truth for all MCP tool names and descriptions.
 * Import these constants in tool definitions to maintain consistency.
 * 
 * Following MCP best practice: Name Tools for Discovery
 * All tool names are prefixed with service name for better discovery.
 */

import { buildToolName, validateToolNames } from './mcp-standards';
import { REPORT_CAPABILITIES } from '@/utils/controllers/reports/reportService';

export interface ToolMetadata {
  name: string;
  description: string;
}

  
/**
 * All tool metadata in one place
 * Tool names are automatically prefixed with service prefix following MCP best practices
 */
export const TOOL_METADATA = {
  HELLO: {
    name: buildToolName('hello'),
    description:
      "Call this tool FIRST, immediately after connecting and before calling anything else. It returns a welcome map of the current user, their accessible boards, Hypertask capabilities, task-link templates, and board-specific house conventions so you can orient before taking action.",
  },

  AGENT_PRESENCE: {
    name: buildToolName('agent_presence'),
    description:
      'Shows live per-agent status (active, idle, or offline) and the current task for a team, derived from session heartbeats. Requires team_id; get it from hypertask_get_user_context or hypertask_hello.',
  },

  LIST_AGENTS: {
    name: buildToolName('list_agents'),
    description:
      'Lists every agent identity owned by the authenticated user, including revoked agents, creation time, and board memberships. Use this to find duplicate or orphaned agents. This read-only tool never returns MCP tokens or other credentials.',
  },

  AGENT_WEBHOOK: {
    name: buildToolName('agent_webhook'),
    description:
      'Gets or manages the signed outbound webhook for one managed agent. Actions: get, configure, test, replay, rotate, or delete. Agent credentials use agent_id=self; a human supplies an owned agent UUID. Configure accepts an HTTPS url, optional project_id filter, events, and active. Test sends a real signed webhook.test delivery. Replay requires delivery_id. Configure and rotate return the signing secret once; store it securely.',
  },

  CREATE_AGENT: {
    name: buildToolName('create_agent'),
    description:
      'Creates an external agent identity owned by the authenticated human, optionally attaching it to boards. Returns its MCP token once; store it securely. Agent credentials cannot call this tool.',
  },

  REVOKE_AGENT: {
    name: buildToolName('revoke_agent'),
    description:
      'Revokes an owned agent identity and invalidates its MCP token. This is an account-management write and requires an authenticated human or management-scoped key.',
  },

  MINT_TOKEN: {
    name: buildToolName('mint_token'),
    description:
      'Mints a fresh account MCP token with a 1–365 day lifetime. Returns the credential once; store it securely. Requires an authenticated human or management-scoped key.',
  },

  REVOKE_TOKEN: {
    name: buildToolName('revoke_token'),
    description:
      'Revokes one signed account MCP token, or all account MCP tokens with revoke_all=true. Requires an authenticated human or management-scoped key.',
  },

  LIST_CONNECTIONS: {
    name: buildToolName('list_connections'),
    description:
      'Lists OAuth client connections authorized by the authenticated human, including the latest authorization and associated agent identity. Never returns credentials.',
  },

  GET_USER_CONTEXT: {
    name: buildToolName('get_user_context'),
    description:
      "Gets the current user's context including boards/projects they have access to, permissions, connected agent (if connected with agent jwt), all agents conntected to thand user information. Returns full project details (combines get_user_context and list_projects). Use this at the start of a conversation to understand what boards/projects the user can interact with. For filtered or paginated project lists, use list_projects instead.",
  },

  UPDATE_PROFILE: {
    name: buildToolName('update_profile'),
    description:
      "Updates the authenticated human user's display name, profile photo URL, or both. Use this for profile changes; agent tokens cannot modify the underlying human profile.",
  },

  LIST_TASKS: {
    name: buildToolName('list_tasks'),
    description:
      'Lists tasks with comprehensive filtering options. Filter by project, section (column title or section_id), assignee, priority, due date, status, labels, and more. Supports pagination and sorting. Results are automatically limited to boards/projects the user has access to. Prefer section_id (positive integer) when known; otherwise use section with the exact section_title from hypertask_section action=list. The CLI resolves section names to section_id per project. Each task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex} where uniqueIndex is extracted from the ticket number.',
  },

  GET_TASKS: {
    name: buildToolName('get_tasks'),
    description:
      'Gets detailed information about one or more tasks including assignees, followers, priority, estimate, due date, labels, attachments, and comment count. Provide task_id as an array of numbers or ticket_number as an array of strings. Tasks are retrieved in parallel for efficiency. Each task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex} where uniqueIndex is extracted from the ticket number (e.g., "HTPR-3550" → 3550).',
  },

  TASK_CONTEXT: {
    name: buildToolName('task_context'),
    description:
      'Gets a focused context pack for one task, including its parent, subtasks, relations, recent comments, and linked pull requests. Requires task_id and project_id. Set summary to true for a shorter comment history.',
  },

  TASK_DESCRIPTION_HISTORY: {
    name: buildToolName('task_description_history'),
    description:
      "Lists a task description's saved versions or restores one version. Use versions before restore to find the required version_id.",
  },

  GET_TASK_TREE: {
    name: buildToolName('get_task_tree'),
    description:
      'Returns the parent/subtask tree for a task, starting from its topmost ancestor. Provide exactly one of task_id or ticket_number. Optionally set depth to limit descendant levels; use 0 for the root only.',
  },

  NEXT_TASKS: {
    name: buildToolName('next_tasks'),
    description:
      'Gets the highest-priority unleased tasks from one accessible board. Optionally limit results or filter by section, blocked status, and comma-separated label names or IDs. Pass cursor when continuing a paginated queue.',
  },

  LINK_TASKS: {
    name: buildToolName('link_tasks'),
    description:
      'Creates, lists, or removes task relations with action link, list, or unlink; link remains the default. Identify each task by task_id, ticket_number, or project_id + unique_index; source and target fields use their respective prefixes. RelatedTo is neutral, BlockedBy means the source is blocked by the target, and BlockedTo means the source blocks the target.',
  },

  SEARCH_TASKS: {
    name: buildToolName('search_tasks'),
    description:
      'Searches for tasks by name, description, or ticket number. Enhanced with filters for assignee (me/unassigned/user ID), priority, section, due date, and status. Results are automatically limited to boards/projects the user has access to. Use this to find tasks before adding comments or performing other actions. Each task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex} where uniqueIndex is extracted from the ticket number.',
  },

  RAG_RETRIEVAL: {
    name: buildToolName('rag_retrieval'),
    description:
      "Semantically searches the caller-accessible board's own tasks and comments, matching meaning even when the wording differs from the query. Use this for conceptual, conversational, or ambiguous questions where keyword search may miss paraphrases or synonyms; use hypertask_search_tasks for exact keywords, task names, ticket numbers, and structured task filters. Pass project_id to search one board. Read-only; results are always limited to boards the authenticated caller can access.",
  },

  SEARCH_HELP_DOCS: {
    name: buildToolName('search_help_docs'),
    description:
      "Searches the Hypertask help center (help.hypertask.ai) for how-to and product-feature articles. Use for questions about how Hypertask itself works — boards, columns/sections, the Command Center (Ctrl+K), keyboard shortcuts, AI features and models, notifications, sharing, pricing, and MCP/CLI setup. Do NOT use for questions about the user's own tasks or comments; use hypertask_list_tasks, hypertask_search_tasks, or hypertask_get_comments_for_task for those.",
  },

  FIND_RELATED_TASKS: {
    name: buildToolName('find_related_tasks'),
    description:
      'Finds related tasks across boards/projects the user can access. Identify an existing task by task_id, ticket_number, or project_id + unique_index, or provide text to check for prior art and duplicates before creating a task.',
  },

  LIST_PROJECTS: {
    name: buildToolName('list_projects'),
    description:
      'Lists all projects/boards the user has access to with filtering and pagination. Use this when you need to filter by status (Normal/Archive), search by title/description, or paginate through large lists. For initial context setup, use get_user_context instead (which includes projects).',
  },

  PROJECT_ADMIN: {
    name: buildToolName('project_admin'),
    description:
      'Archives or restores an owned board, or invites a human user or agent to an accessible board. Use action archive with status Archive or Normal, or invite_member with userToAdd.',
  },

  BOARD_MANIFEST: {
    name: buildToolName('board_manifest'),
    description:
      'Gets a board manifest with its ordered columns, column IDs, semantic roles, and transition policy. Use this before planning task movement or interpreting the board workflow.',
  },

  GET_BOARD_PLAYBOOK: {
    name: buildToolName('get_board_playbook'),
    description:
      'Gets a board playbook containing its working rules and definition of done, or null when none is set. Use this before starting work on tasks from the board.',
  },

  BOARD_CONFIG: {
    name: buildToolName('board_config'),
    description:
      "Gets or sets a board's playbook or AI custom instructions. Use the matching action before agent work or when board-level guidance changes.",
  },

  CREATE_BOARD: {
    name: buildToolName('create_board'),
    description: `Creates a new board under a team in one API call from a structured manifest (HTPR-3142). You build title, sections[], optional labels[], optional tasks[]; the backend does not run an LLM on a prompt.

Workflow columns (Linear/Jira-style delivery, not category buckets): Use columns strictly as left-to-right delivery state. Do not use phase/theme buckets (e.g. "Discovery", "Foundation") unless the user explicitly asks for a roadmap-by-phase board. Prefer product-grade status names over generic one-word defaults—examples: "Triage" → "Scheduled" → "In development" → "In review" (code review + QA) → "Shipped", or "New" → "Planned" → "Active" → "Validation" → "Complete". Adapt wording to the domain (e.g. "Compliance sign-off" instead of "In review") while keeping the same semantic order: intake → committed → building → verify → done.

Task placement (honest workflow, not fake progress): Columns must represent **real** delivery state. If the user states where work lives ("in QA", "already shipped", "this sprint in dev"), follow that.
- **Greenfield / day-zero default** (no evidence that implementation or review has started): Put **most** cards in the **first two columns**—rough guide: **~40–55% Triage** (intake, unclear, parked, not yet refined), **~35–50% Scheduled** (refined, queued, ready to pull, not yet building). **In development**: only **near-term or explicitly started** slices—aim **≤15%** of the backlog unless the user said a team is already coding. **In review**: **empty** unless the user said verification/review is underway. **Shipped**: **empty** unless the user said work is done. **Never** place the majority of a brand-new backlog in **In development** or **In review**—that reads as made-up progress.
- Within Triage vs Scheduled, still bias **riskier, unclear, or dependency-heavy** items **left**.
- **Mature / in-flight** projects: when the user describes active sprints or QA, relax the caps above accordingly.

Hierarchy: Manifest **tasks[]** is a **flat** list (no parent pointers in the schema). Do not emit a flat wall of unrelated siblings for huge specs: (1) Offer or use **high_level** (~15–45 **epic**-scale titles) when the user wants a thin rollup first; break out **children** afterward with **hypertask_create_task** + **parent_task_id** on the epic task. (2) Or keep **one** create_board but use **stable epic/area groupings** in titles (consistent prefixes like CWE ·, Dealer ·, INT:—same pattern throughout) and optional **rollup** tasks—epic summary cards in **Triage**, concrete leaves in **Scheduled** until they are truly in progress. (3) When the user asks for **explicit parent/child**, create **parents first**, then **children** via **hypertask_create_task** with **parent_task_id**.

Realistic boards (task count): Default is a **delivery-ready backlog**, not a compressed summary. For **large specs**—multiple long documents, full-platform architecture, dozens of flows/integrations—emitting only ~25–40 tasks is **under-delivery** and should be avoided unless the user explicitly chose executive-summary mode. **Order of magnitude:** small focused PRD → ~15–45 tasks; **big multi-PDF / multi-system specs → almost always 100–250+ starter tasks**, and **250–450+** when the source clearly enumerates that much surface (use capacity up to the tool max). Split work so each card is one **concrete deliverable** (a flow slice, an engine capability, an integration adapter + wiring, a portal module, a QA/SLA gate)—never one card per entire doc or chapter unless high-level mode. If you must drop scope, say so in source_summary rather than silently merging everything into a handful of epics.

Labels vs columns: Use labels for area/track/component/risk (e.g. Frontend, Security). Use columns only for workflow state.

Planning fields (non-optional in practice): For every task in tasks[], you MUST set priority and estimate unless the user explicitly asked for a board without them. Omitting them produces empty boards in the UI and defeats planning. priority: integer 0–4 with the same semantics as create_task (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)—infer from risk, dependencies, revenue/compliance, and "blocking" language in source material; avoid setting everything to the same value without reason. estimate: integer matching product sizes only—0 = no size, 2 = XS through 6 = XL (see EstimateConstants; indices 1 and 7 are invalid on API). Prefer 2–6 for sized work; use 0 only if the user explicitly wants no estimate. Spread estimates realistically across tasks. Optionally set due_date (ISO 8601) when sources name deadlines or milestones.

Single board, full manifest: Prefer **one** board with the entire decomposed backlog (100–250+ tasks when warranted) in **one** create_board call. Do not split across multiple boards or thin the task list to avoid timeouts unless the user explicitly asked for separate boards or a summary-only board. If the tool fails with a request timeout, that is an environment/MCP HTTP timeout—the operator should raise CREATE_BOARD_REQUEST_TIMEOUT_MS (or equivalent), not shard work across boards by default.

Board title: Use a **short, unique board name** (usually the product or program). Do **not** stack the product name plus a long document title plus dates in title—that reads as duplicated scope; put doc names, ingest notes, and dates in **description** and **source_summary**.

Technical: Requires team_id from get_user_context.teams (UUID string or number). sections are { title } objects in column order. Each task needs exactly one of section_index (0-based into sections) or section_title (must match a section title). Per task also use: description (HTML), label_names (must match manifest labels), priority, estimate, optional due_date. Optional source_summary for audit trail.`,
  },

  LIST_PROJECT_MEMBERS: {
    name: buildToolName('list_project_members'),
    description:
      'Lists project/team members for a given project. Also includes all agents created by members in the board. Use this before adding a comment with @mentions to resolve display names to user IDs. Returns id, displayName, and email for each member. Match @DisplayName in comment text to displayName (case-insensitive, longest match first). Pass resolved { user_id, display_name } in the mentions array when calling add_comment_to_task.',
  },

  CREATE_LABEL: {
    name: buildToolName('create_label'),
    description:
      'Creates a new label in a project. Use this when the user wants to add a label that does not exist yet. Requires project_id and name. After creating, the label can be assigned to tasks via create_task or update_task. Use list_projects or get_user_context to see existing labels per project.',
  },

  LIST_LABELS: {
    name: buildToolName('list_labels'),
    description:
      'Lists labels available on one project/board. Use before assigning labels when you need valid label IDs. Requires project_id.',
  },

  LIST_CUSTOM_FIELDS: {
    name: buildToolName('list_custom_fields'),
    description:
      'Lists the custom fields defined on one board, including field IDs, names, types, Select options, and value counts. Identify the board with project_id. Use this before setting a value when you need the available field definitions.',
  },

  SET_CUSTOM_FIELD_VALUE: {
    name: buildToolName('set_custom_field_value'),
    description:
      "Writes or clears a custom-field value on one task, identified by its numeric task_id. Identify the field with exactly one of field_id or field_name. A missing field_name is auto-created as a Number field when writing a non-empty value. Pass null or an empty string to clear the value.",
  },

  SECTION_CRUD: {
    name: buildToolName('section'),
    description:
      'Full CRUD for board columns/sections. Use action to choose: list (all columns for a board, including autoAssign), get (one column + its tasks), create (new column), update (rename/move column, mark it done via is_done, or set its auto-assignee via auto_assign), delete (remove column). Required: action, project_id. For get/update/delete also need section_id. For create need title. For update need at least title, move_after_section_id, is_done or auto_assign. Use this for board organization, including auditing and clearing stale auto-assign rules.',
  },

  GET_COMMENTS: {
    name: buildToolName('get_comments_for_task'),
    description:
      'Gets user comments for a specific task, including each active reaction with its emoji, reactor user ID, and display name when available. Use task_id or ticket_number (e.g., "DEV-1") to identify the task. Set include_activity=true to include chronological task history such as label, move, assignment, and priority changes. Supports pagination and sorting by creation date for comments-only results.',
  },

  ADD_COMMENT: {
    name: buildToolName('add_comment_to_task'),
    description:
      'Add, update, or delete a comment. Use action: add (create comment, requires task_id or ticket_number + text), update (edit comment, requires comment_id + text), delete (remove comment, requires comment_id only). For update/delete, call get_comments_for_task first to obtain comment_id. For add or update, text may be HTML or structural markdown; content_type can explicitly select either format. When an agent answers a request, pass the invoking comment ID as reply_to_comment_id so the requester receives the answer in Important. When the mention was in the task description (no comment ID), pass the agent Mentioned notification ID as reply_to_invocation_id instead; never pass both. For @mentions: use @DisplayName in text, then call list_project_members to resolve each name to { user_id, display_name } and pass in the mentions array. For action=add, optional attachments[] uploads files to the new comment; each file needs filename, content_type, and exactly one of data=base64 bytes or url=https. The comment keeps success=true if only attachments fail; inspect attachment_status and the task before retrying attachments, and never repeat the add operation.',
  },

  UPDATE_COMMENT: {
    name: buildToolName('update_comment'),
    description:
      'Updates one of your comments. Supports plain-text @mentions; mentioned users must belong to the task project. Requires comment_id and non-empty HTML or structural markdown text; content_type and mentions are optional.',
  },

  DELETE_COMMENT: {
    name: buildToolName('delete_comment'),
    description:
      'Deletes one of your comments. HyperAI-authored comments may also be deleted when accessible. Requires comment_id; call get_comments_for_task first to obtain it.',
  },

  CREATE_PAGE: {
    name: buildToolName('create_page'),
    description:
      'Creates a rich document attached to a task identified by task_id, ticket_number, or project_id + unique_index. Content is markdown by default; set content_type to html when supplying HTML. Optionally provide a title or parent_page_id to create a nested page.',
  },

  GET_PAGE: {
    name: buildToolName('get_page'),
    description:
      'Gets a rich task-attached document identified by page_id (a numeric page ID or publicId); id is still accepted for backward compatibility. Returns markdown content by default; set format to html when the original rich HTML is needed.',
  },

  UPDATE_PAGE: {
    name: buildToolName('update_page'),
    description:
      'Renames or updates the rich task-attached document identified by page_id; id is still accepted for backward compatibility. Pass title to rename without replacing content. Content is markdown by default. Use mode replace, append, or prepend; pass if_version from get_page for conflict-safe edits that reject stale writes.',
  },

  LIST_PAGES: {
    name: buildToolName('list_pages'),
    description:
      'Lists rich documents attached to one task or available in one project. Identify a task with task_id, ticket_number, or project_id + unique_index; otherwise provide project_id to list project pages. Results are limited to pages the caller can access.',
  },

  SEARCH_PAGES: {
    name: buildToolName('search_pages'),
    description:
      "Searches page titles and content by keyword across the caller's accessible pages. Returns matching rich task-attached documents with short content snippets.",
  },

  PAGE_HISTORY: {
    name: buildToolName('page_history'),
    description:
      "Lists saved versions, restores a selected version, or archives the page identified by page_id; id is still accepted for backward compatibility. Use versions before restore to find the required version_id.",
  },
  REPORT_CRUD: {
    name: buildToolName('report'),
    description: `Full CRUD for board reports. Use action to choose: list, get, create, update, or delete. Required for every action: project_id. Get, create, update, and delete also require slug. Create requires title and body_html. Update accepts title, description, or body_html. Pick a short kebab-case slug, bake all report data into the HTML because it cannot be fetched later, and give the user the returned url. ${REPORT_CAPABILITIES}`,
  },

  LIST_VIEWS: {
    name: buildToolName('list_views'),
    description:
      'Lists saved filtered tabs (views) the user can access, optionally filtered by board/project and visibility. Use this first to find a view ID before getting, updating, deleting, or switching views.',
  },

  GET_VIEW: {
    name: buildToolName('get_view'),
    description:
      'Gets one saved board view and its filters, sorting, subtask display setting, and visibility. Find the ID with hypertask_list_views first.',
  },

  CREATE_VIEW: {
    name: buildToolName('create_view'),
    description:
      'Creates a saved filtered tab on a board. Provide project_id and title; optional subtask_setting controls how subtasks appear. Filters is a nested object containing optional label_names, assignee_ids, and match. Use hypertask_list_views afterward to find saved view IDs.',
  },

  UPDATE_VIEW: {
    name: buildToolName('update_view'),
    description:
      'Updates a saved board view, including its subtask display setting. Filter fields are flat for updates: label_names, assignee_ids, and match. Find the ID with hypertask_list_views first.',
  },

  DELETE_VIEW: {
    name: buildToolName('delete_view'),
    description:
      'Deletes a saved board view. Find the ID with hypertask_list_views first.',
  },

  SWITCH_VIEW: {
    name: buildToolName('switch_view'),
    description:
      "Switches the caller's active saved view, changing what the user's highlighted board tab shows. Find the ID with hypertask_list_views first. Passing the board's default view ID returns the user to the default/all-tasks view.",
  },

  LIST_SKILLS: {
    name: buildToolName('list_skills'),
    description:
      'Lists personal skills when project_id is omitted, or skills shared with a project when project_id is provided. Enabled skills can be invoked as /slug in AI chat or from @hyperai comments.',
  },

  GET_SKILL: {
    name: buildToolName('get_skill'),
    description:
      'Gets one personal or project skill by skill_id, including its /slug invocation, instructions, scope, source, and enabled state for use in AI chat or @hyperai comments.',
  },

  CREATE_SKILL: {
    name: buildToolName('create_skill'),
    description:
      'Creates a personal skill (scope=user) or project skill (scope=project with project_id). Provide complete SKILL.md content in markdown, or provide name + slug + body. The slug becomes the /slug invocation in AI chat and @hyperai comments.',
  },

  UPDATE_SKILL: {
    name: buildToolName('update_skill'),
    description:
      'Updates a personal or project skill by skill_id, including its name, /slug invocation, instructions, description, argument hint, enabled state, or complete SKILL.md markdown used in AI chat and @hyperai comments.',
  },

  DELETE_SKILL: {
    name: buildToolName('delete_skill'),
    description:
      'Deletes a personal or project skill by skill_id, removing its /slug invocation from AI chat and @hyperai comments.',
  },

  IMPORT_SKILLS: {
    name: buildToolName('import_skills'),
    description:
      'Imports skills from a GitHub URL into personal scope (scope=user) or project scope (scope=project with project_id). Supports dry_run and selecting slugs; imported skills are invoked as /slug in AI chat or @hyperai comments.',
  },

  ATTACH_FILES: {
    name: buildToolName('attach_files'),
    description:
      'Uploads one or more files to a task as attachments (same as web UI / CLI --attach). Requires task_id OR ticket_number OR (project_id + unique_index). Optional comment_id: set after add_comment_to_task so files are linked to that comment. Each file in files[] must include filename, content_type (MIME), and exactly one of: data (raw base64, not a data: URL) or url (http/https for the server to fetch). Max 10 files per call. Returns attachment ids and public URLs when available.',
  },

  UPDATE_TASK: {
    name: buildToolName('update_task'),
    description:
      'Updates a task after assessing get_comments and get_tasks. Updates description, title, priority, estimate, due_date (ISO 8601, e.g. "2026-03-10"), status(column/section), followers, labels, and more. Use this when the user wants to update a task. Requires task_id or ticket_number to identify the task. Description may be HTML or markdown; set content_type to "markdown" for markdown. Optional attachments[] can be the only update or accompany other fields; each file needs filename, content_type, and exactly one of data=base64 bytes or url=https. When attachments accompany other fields, the task update keeps success=true if only attachments fail; inspect attachment_status and the task before retrying attachments instead of repeating the update. An attachment-only call fails if no attachment is stored. The updated task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}.',
  },

  CREATE_TASK: {
    name: buildToolName('create_task'),
    description:
      'Creates a new task in a project. Requires project_id and title. Optionally set description, section (by section_id), priority (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low), estimate, due_date (ISO 8601, e.g. "2026-03-10"), labels, and attachments[]. Each attachment needs filename, content_type, and exactly one of data=base64 bytes or url=https; uploaded public URLs are returned. Use hypertask_section with action=list to find the correct section_id for the target column, parent_task_id to create task as a sub-task. IMPORTANT: If the user requests to create a task but does not specify which project or section, you MUST ask them to clarify before creating the task. Do not assume or pick a project/section automatically. First call get_user_context or list_projects to show available options, then ask the user to choose. Description may be HTML or markdown; set content_type to "markdown" for markdown. The created task includes a "link" field with the task URL: https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}. The task keeps success=true if only attachments fail; inspect attachment_status and the task before retrying attachments, and never repeat create.',
  },

  MOVE_TASK_BETWEEN_BOARDS: {
    name: buildToolName('move_task_between_boards'),
    description:
      'Moves a task from one board/project to another. Use this ONLY when the user explicitly wants to move a task between different boards (projects). For moving a task between columns within the SAME board, use update_task with sectionId instead. Requires task identification (task_id, ticket_number, or project_id+unique_index) and target_project_id (the destination board). Optionally specify target_section_id to place the task in a specific column on the new board—use hypertask_section with action=list and the target project to find section IDs. The moved task includes a "link" field with the task URL.',
  },

  ASSIGN_USER: {
    name: buildToolName('assign_user'),
    description:
      'Assign or unassign a user or agent to a task. Use intent (default assign): idempotent — assigns if not already assigned; does not unassign. Use intent unassign to remove the assignee. Use list_project_members to resolve display names to user IDs or agent IDs. Requires task identification (task_id, ticket_number, or project_id+unique_index) and one of user_id (single), user_ids (array for multiple), agent_id (one owned agent), or assign_self (calling agent). Assigning a user removes them from followers if they were a follower. Creates activity log and sends notifications.',
  },
  INBOX_LIST: {
    name: buildToolName('inbox_list'),
    description:
      "Lists notifications for the authenticated user and connected agent. Set composition to true with project_id to return counts showing that board's inbox noise by recipient, type, actor, and split instead.",
  },
  INBOX_ARCHIVE: {
    name: buildToolName('inbox_archive'),
    description: 'Archive one or multiple notifications from the user\'s inbox. Use when the user wants to archive notifications. Requires notification_ids (array of integers). Use inbox_list first to get notification IDs.',
  },
  INBOX_UNARCHIVE: {
    name: buildToolName('inbox_unarchive'),
    description:
      'Restore one or multiple archived inbox notifications so they appear in the inbox again. Requires notification_ids (array of integers)—the same notification ids from inbox_list before they were archived. Use when the user wants to unarchive or undo an archive.',
  },
  MOVE_TASK_TO_INBOX: {
    name: buildToolName('move_task_to_inbox'),
    description:
      "Route a task into a specific project member's inbox so they notice it (the same as the \"Move task to inbox\" command-palette action). Use when a human needs to be nudged about a task an agent created or handled. Requires user_id (the recipient, who must be a member of the task's project) plus a task identifier: task_id, ticket_number, or (project_id + unique_index). Self-assign and self-mention do not notify, so use this to get a task in front of someone.",
  },
  TIME: {
    name: buildToolName('time'),
    description:
      'Track time with action: start, stop, status, running, report, or log. Start/stop/status/log require a task id, unique index, or ticket id. Log also requires minutes. Report supports board, task, user, from, to, and running filters.',
  },
  PAUSE_TIMER: {
    name: buildToolName('pause_timer'),
    description:
      'Pause the running timer for a task. Requires a task id, unique index, or ticket id.',
  },
  RESUME_TIMER: {
    name: buildToolName('resume_timer'),
    description:
      'Resume the paused timer for a task. Requires a task id, unique index, or ticket id.',
  },
  DECISION_REQUEST: {
    name: buildToolName('decision_request'),
    description:
      'Create and resolve durable requests for a human decision. Use action: create (task identifier + question + 2-10 distinct options), list (task identifier + optional status), get (decision_request_id), answer (decision_request_id + selected_option + optional note), or cancel (decision_request_id). selected_option must exactly match one option returned by create/get/list. Agents cannot answer decision requests; answer requires a human user token.',
  },
  DRAFT_CRUD: {
    name: buildToolName('draft'),
    description:
      'Full CRUD for task drafts (both comment and description drafts). Use action to choose: create (requires task_id/ticket_number + text + optional draft_type), list (requires task_id/ticket_number to see existing drafts), update (requires draft_id + text to edit draft), publish (requires draft_id — creates the actual comment/description from the draft), delete (removes a draft). The text field MUST be in HTML format for create/update (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks). A task can have at most one comment draft and one description draft.',
  },
} as const;

/**
 * Extract just the names for easy iteration
 */
export const TOOL_NAMES: string[] = Object.values(TOOL_METADATA).map((tool) => tool.name);

/**
 * Helper to get tool metadata by name
 */
export function getToolMetadata(name: string): ToolMetadata | undefined {
  return Object.values(TOOL_METADATA).find((tool) => tool.name === name);
}

/**
 * Validate that all tools are registered and follow naming standards
 */
export function validateToolMetadata(registeredToolNames: string[]): void {
  const expectedTools = new Set(TOOL_NAMES);
  const registeredTools = new Set(registeredToolNames);

  // Find missing tools
  const missing = [...expectedTools].filter((name) => !registeredTools.has(name));
  
  // Find extra tools (not in metadata)
  const extra = [...registeredTools].filter((name) => !expectedTools.has(name));

  // Validate naming standards
  const validationResults = validateToolNames(registeredToolNames);
  const invalidNames = validationResults.filter((r) => !r.valid);

  if (missing.length > 0) {
    console.warn(`⚠️  Tools defined in metadata but not registered: ${missing.join(', ')}`);
  }

  if (extra.length > 0) {
    console.warn(`⚠️  Tools registered but not in metadata: ${extra.join(', ')}`);
  }

  if (invalidNames.length > 0) {
    console.error(`❌ Tools with invalid naming (must start with service prefix):`);
    invalidNames.forEach(({ name, error }) => {
      console.error(`   - ${name}: ${error}`);
    });
  }

  if (missing.length === 0 && extra.length === 0 && invalidNames.length === 0) {
    console.info(`✓ All ${registeredTools.size} tools properly registered and follow naming standards`);
  }
}
