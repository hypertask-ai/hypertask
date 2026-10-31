# MCP tools: consolidated catalog

Scope: sections 1, 2 and 3 of https://app.hypertask.ai/detail/project-15/6804. Golden task data is supplied for the separately owned harness.

## Rollout and compatibility

The consolidated catalog is permanent for authenticated MCP clients. The rollout flag was retired after more than 14 days on Everyone. Full human credentials receive resource tools without deferred meta-tool advertisements. Read-only or management-only credentials see only authorized resources and action enums. Managed agents do not see human-only profile or account administration actions; team-scoped management keys do not see account-wide connections or tokens. Existing REST authentication, board membership, ownership, team boundaries and permission checks remain authoritative.

All 74 existing resource names plus both discovery names remain callable for clients with cached definitions. Hidden aliases forward the original arguments, bearer credential and invocation identity to the same existing implementation. The existing `hypertask_time` name is already consolidated; it accepts the previous flat arguments as well as the new nested input and returns the new envelope on MCP. Other aliases preserve their original response text and add structured content for JSON results. Turning the flag off intentionally removes new names from the advertised/callable catalog; clients should refresh discovery after a flag change.

## Usage inventory and resource decisions

There is no reachable **30-day** per-tool usage query or stored transcript source in this checkout. `src/lib/mcp-server/utils/logger.ts` emits invocation records to **stderr**. `mcpSseAnalytics.ts` measures transport usage, while CLI telemetry and AI usage records are not per-tool MCP call counts. No production database or external log credentials were used. This is a resource-based inventory, not a claim about usage frequency. Revisit the grouping after the separately owned eval harness produces transcripts.

Group operations that use the same identifiers, authorization and workflow context: ticket create/read/update/move/assign, comment CRUD, board administration, page CRUD/history, view CRUD, skill CRUD/import and timer controls. Keep distinct resources for columns, labels, custom fields, inbox notifications and attachments so destructive or specialist actions are not confused with ticket edits. Keep search separate from known-ticket retrieval, account orientation separate from board lists, credentials separate from agent identities, and outbound webhooks separate from identity administration. Reports, decisions and drafts are distinct persisted document workflows. Action enums disambiguate within each resource, rather than advertising a tool per endpoint. No endpoint or existing business implementation is replaced.

## Input, descriptions and output

Each advertised tool has four labeled prose parts: **Does**, **Use when**, **Do not use when**, **Parameters and caveats**. One JSON file per tool lives in `src/lib/mcp-server/config/descriptions/`; the shared `parameters.json` supplies meanings where the existing parameter schemas omitted descriptions. Each action branch has the existing nested schema, with clearer spellings such as `user_id`, `view_id`, `section_id`, `member_identifier` and `task_identifier`. These are translated at the MCP boundary, not in REST. Task create/update and board manifest/create have schema-checked `input_examples`.

New calls use `{ action, input, response_format?, limit?, offset? }`. Reads default to `response_format: concise`, `limit: 20` (maximum 50), `offset: 0`. Ticket summaries expose `id`, `ticket`, `title`, workflow `status`, `assignee` and `due`; list endpoints that only know an assignee count cannot invent names. `detailed` retains original fields, including document content, but still bounds collections. Search evidence retains source identifiers and passage text. Writes always preserve detailed receipts, one-time credentials, partial upload outcomes and retry guidance.

Every advertised tool supplies an object `outputSchema` and returns matching `structuredContent` plus a text JSON representation. The envelope is `{ data, response_format, pagination? }`. Existing endpoint limits, offsets and cursors are forwarded when supported. Otherwise collections are sliced locally; use top-level offset for the next window. Limit-only endpoints fetch the skipped prefix, requested window and one lookahead row, without exceeding their own row caps; a full capped response is explicitly marked truncated with guidance to narrow the query, even when no further local window is available. Nested input limits also bound the returned window and are validated against the original endpoint schema before calculating the fetch budget; invalid limits never execute an endpoint. Cursor endpoints do not overfetch lookahead rows, and a supplied input cursor takes precedence over local offset slicing. Nested resource collections are capped too; their truncation asks for targeted follow-up reads rather than claiming a resumable global page. Document nodes, decision options and view configuration arrays are not result collections and remain intact, regardless of limit or offset. Response pagination retains upstream cursors, reports continuation and recommends many small targeted searches. Detailed mode changes field richness, not the row cap. Detailed text bodies are not cut mid-document. Concise help/document hits with source URLs keep a 2,000-character excerpt and explicitly request detailed mode when truncated.

For the new catalog, invalid arguments, unsupported actions, authorization failures, returned `Error:` strings, JSON failure objects and thrown execution errors produce `isError: true` tool results. Malformed JSON-RPC still uses protocol errors. Validation names the field and explains how to change it; for example, `project_id is required when unique_index is given; pass the project id or use ticket_number`. Permission errors request the proper credential and board membership; transient errors warn callers to inspect writes before retrying. Internal exception details and credential-looking strings are not echoed. Flag-off protocol and response behavior remains unchanged.

HTTP and existing legacy SSE share the permanent consolidated catalog and output/error behavior. Already-open SSE sessions resolve the relayed credential scope and remaining schema flags for every tool list or call. Invocation identity retains the SSE session id. Only the response bindings change; transport, OAuth, annotations and Directory work belong to https://app.hypertask.ai/detail/project-15/6478. The eval harness and CI integration belong to https://app.hypertask.ai/detail/project-15/6505; `tests/fixtures/mcp-6804/golden-tasks.json` contains 25 seeded, realistic tasks as data only. Run mutating tasks only against an isolated fixture environment, never production or shared previews. Chat tool extraction belongs to https://app.hypertask.ai/detail/project-15/6506 and can consume this catalog later; it is not changed here.

## Scope-limited agent skills

A team-bound agent sees only skills on boards readable within its credential's team. With `htpr-7663-scoped-agent-skills` enabled server-side (Owner + QA by default), MCP and app-chat skill lists without `project_id` return those readable board skills; flag off or a flag lookup failure refuses unfiltered team-bound discovery without weakening scope restrictions. With either flag state, a supplied `project_id` narrows the list and must be accessible. Account-wide personal skills remain unavailable for reads, writes, imports and prompt resolution. App chat applies the same scope to skill discovery and slash-skill resolution. Human sessions and credentials without a team binding retain personal-skill access. Built-in formatting skills remain available.

## Comment timestamps

`GET /api/mcp/comments`, `POST /api/mcp/comments` and `PATCH /api/mcp/comments/:comment_id` include `editedAt` on each returned comment: an ISO timestamp of its latest text edit, or `null` if it has never been edited. Existing comments are not backfilled. Reactions and other non-text changes do not mark a comment edited. `editedBy` is `{ userId, agentId }` for the latest editor, or `null` when never edited; `agentId` is `null` for a human edit. An agent editing its owner's comment is recorded as the editor without changing the comment's original author. Editor names are not included because there is no existing editor-agent relation to select.

Each reaction in the comments list includes its `createdAt` ISO timestamp. `POST /api/mcp/comments/:comment_id/reactions` includes the same field in both `reaction` (when present) and `reactions`. This is the stored reaction's original creation time; reviving a removed reaction preserves it. Existing reactor attribution is unchanged: `userId` identifies the human or agent owner, and agent reactions also carry `isAgent: true` and the visibility-filtered `agent` object.

## Complete resource inventory

| Advertised tool | Actions | Existing implementation names |
| --- | --- | --- |
| `hypertask_custom_fields` | `list`, `set` | `hypertask_list_custom_fields`, `hypertask_set_custom_field_value` |
| `hypertask_time` | `start`, `stop`, `status`, `running`, `report`, `log`, `pause`, `resume` | `hypertask_time`, `hypertask_pause_timer`, `hypertask_resume_timer` |
| `hypertask_sections` | `list`, `get`, `create`, `update`, `delete` | `hypertask_section` |
| `hypertask_attachments` | `attach` | `hypertask_attach_files` |
| `hypertask_decisions` | `create`, `list`, `get`, `answer`, `cancel` | `hypertask_decision_request` |
| `hypertask_views` | `list`, `get`, `create`, `update`, `delete`, `switch` | `hypertask_list_views`, `hypertask_get_view`, `hypertask_create_view`, `hypertask_update_view`, `hypertask_delete_view`, `hypertask_switch_view` |
| `hypertask_tasks` | `list`, `get`, `context`, `tree`, `next`, `versions`, `restore`, `link`, `links`, `unlink`, `create`, `update`, `move`, `assign`, `waiting_on`, `follow`, `archive`, `delete`, `share`, `share_state` | `hypertask_list_tasks`, `hypertask_get_tasks`, `hypertask_task_context`, `hypertask_get_task_tree`, `hypertask_next_tasks`, `hypertask_task_description_history`, `hypertask_link_tasks`, `hypertask_create_task`, `hypertask_update_task`, `hypertask_move_task_between_boards`, `hypertask_assign_user`, `hypertask_follow_task`, `hypertask_set_task_waiting_on`, `hypertask_archive_task`, `hypertask_delete_task`, `hypertask_share_task`, `hypertask_get_task_share` |
| `hypertask_tokens` | `mint`, `revoke` | `hypertask_mint_token`, `hypertask_revoke_token` |
| `hypertask_webhooks` | `get`, `configure`, `test`, `replay`, `rotate`, `delete` | `hypertask_agent_webhook` |
| `hypertask_skills` | `list`, `get`, `create`, `update`, `delete`, `import` | `hypertask_list_skills`, `hypertask_get_skill`, `hypertask_create_skill`, `hypertask_update_skill`, `hypertask_delete_skill`, `hypertask_import_skills` |
| `hypertask_agents` | `list`, `presence`, `create`, `revoke`, `archive`, `delete`, `request_board_access`, `get_board_access_request` | `hypertask_list_agents`, `hypertask_agent_presence`, `hypertask_create_agent`, `hypertask_revoke_agent`, `hypertask_archive_agent`, `hypertask_delete_agent`, `hypertask_request_board_access`, `hypertask_get_board_access_request` |
| `hypertask_comments` | `list`, `add`, `update`, `delete` | `hypertask_get_comments_for_task`, `hypertask_add_comment_to_task`, `hypertask_update_comment`, `hypertask_delete_comment` |
| `hypertask_user_context` | `hello`, `features`, `get`, `profile`, `connections` | `hypertask_hello`, `hypertask_list_features`, `hypertask_get_user_context`, `hypertask_update_profile`, `hypertask_list_connections` |
| `hypertask_pages` | `create`, `get`, `update`, `list`, `search`, `versions`, `restore`, `archive` | `hypertask_create_page`, `hypertask_get_page`, `hypertask_update_page`, `hypertask_list_pages`, `hypertask_search_pages`, `hypertask_page_history` |
| `hypertask_reports` | `list`, `get`, `create`, `update`, `delete` | `hypertask_report` |
| `hypertask_projects` | `list`, `manifest`, `playbook`, `create`, `rename`, `members`, `archive`, `invite_member`, `get_playbook`, `set_playbook`, `get_instructions`, `set_instructions` | `hypertask_list_projects`, `hypertask_board_manifest`, `hypertask_get_board_playbook`, `hypertask_create_board`, `hypertask_rename_board`, `hypertask_list_project_members`, `hypertask_project_admin`, `hypertask_board_config` |
| `hypertask_inbox` | `list`, `archive`, `unarchive`, `move_task` | `hypertask_inbox_list`, `hypertask_inbox_archive`, `hypertask_inbox_unarchive`, `hypertask_move_task_to_inbox` |
| `hypertask_labels` | `list`, `create` | `hypertask_list_labels`, `hypertask_create_label` |
| `hypertask_search` | `tasks`, `semantic`, `related`, `help` | `hypertask_search_tasks`, `hypertask_rag_retrieval`, `hypertask_find_related_tasks`, `hypertask_search_help_docs` |
| `hypertask_drafts` | `create`, `list`, `update`, `publish`, `delete` | `hypertask_draft` |

## Feature discovery

`hypertask_list_features`, `hypertask_user_context` action `features`, and `GET /api/mcp/features` return enabled feature-kind flags and core destinations for the authenticated user, with descriptions, shipped dates and verified URLs where known. `htpr-7322-agent-feature-discovery` defaults to Everyone; switching it Off disables catalog reads, hides discovery guidance from hello, and suppresses agent page-creation warnings, including on idempotent replays. Page creation itself remains available.

## Acting as an owned agent

A person's MCP connection (OAuth or account token, not an agent token or management key) can talk on a board as one of their agents without holding its token. This is behind `htpr-7529-mcp-act-as-agent` (Owner + QA); with it off, `as_agent` is not advertised and is refused, and `ensure` on create is refused.

1. `hypertask_agents create {display_name, project_ids, role, ensure: true}` returns the caller's active agent with that display name (case-insensitive), adding any missing boards, or creates it. Calling it again returns the same id. It never returns a token.
2. `as_agent: <agent UUID>` inside `input` on `hypertask_tasks` create/update/move/assign, `hypertask_comments` list/add/update/delete and `hypertask_decisions` create/list/get/cancel runs the action with the agent's identity. The server checks that the caller owns the agent, that it is not revoked or archived, that it is an Accepted member of the ticket's board (and of `target_project_id` on move), and that a read-role agent does not write.
3. `hypertask_inbox list {as_agent}` returns the agent's notifications in `agent_notifications`, each with the comment id to pass as `reply_to_comment_id` (or the notification id for `reply_to_invocation_id` when the mention was in a description). `archive` and `unarchive` take `as_agent` too.
4. `hypertask_webhooks configure {agent_id, url, events: ["comment.mention", "comment.created"]}` makes Hypertask post a signed delivery with the ticket number, comment id and author whenever someone mentions the agent, so a host that supports external wakes can start a session. Polling `inbox list {as_agent}` stays the fallback.

## Autonomous anonymous feedback

`hypertask_report_feedback` lets an AI client report a failed or unexpected Hypertask operation on its own, without being asked. Never send task, board or comment content, request bodies or tool arguments. The server stores structured fields including an optional category (call_failed, empty_result, unexpected_result, auth_failed, slow, user_reported_broken or other; default other), reporting display names and client slugs. Free-form error and note remain accepted for compatibility but are never stored. Credential-shaped tool, client and errorCode values are rejected. This tool is available only to the audience of `htpr-7195-ai-feedback`, a feature flag defaulting to Owner + QA. It adds one tool to either catalog; with feedback off, the existing legacy and consolidated catalogs stay unchanged.

REST clients use `POST /api/mcp/feedback` with the existing bearer authentication and JSON `{surface, client?, tool?, status?, errorCode?, category?, error?, note?}`. `surface` is `mcp`, `cli`, `api` or `agent`; tool names are bounded technical identifiers, status is an integer from 100 to 599, client and errorCode are slugs up to 40 characters, and error/note accept up to 5000 characters but are never persisted. Reports show `Category: <value>` and, when free text was supplied, `Free text was supplied and not stored, for privacy.` Credential-shaped structured fields return 400; automatic reporting drops those fields. Repeat reports preserve the original report and human triage, changing only reporting metadata and Last seen. Destination writes retry lock acquisition up to 20 times, 250 ms apart, before returning 503. Unknown fields are rejected. Success returns `{success:true,ticketNumber,url,deduped,count}` with the board-15 ticket URL. Invalid input returns 400, unauthenticated calls 401, disabled calls 404, hourly quota exhaustion 429, and unavailable feedback storage 503. The MCP surface and client attribution are set by the server, using clientInfo when available.

Reports land in board 15, Bugs, with the ai-feedback label and Medium priority. A structured failure fingerprint bumps an existing open report instead of creating another. Reporting display names and client lists are deduped and capped at 10 each. Per-account rolling hourly quotas permit 10 new tickets and 30 bumps. Anonymous MCP authentication failures are enabled only in Everyone mode and share one 20-report hourly bucket. Redis holds quota reservations, sanitized client metadata for one hour, and a short destination write lock. If Redis is unavailable, filing fails closed; it never bypasses the quota. A reserved attempt is not refunded on failure because ticket creation may already have committed before a side effect failed. Automatic reporting uses waitUntil, never copies exception messages or response content, and does not change or await the original response.

## Agent comment visibility

An agent comment without `kind`, a reply target, a person @mention, images or attachments goes to the hidden ticket agent log, not the conversation people read. For people, use `kind: "question"` for a decision, `"qa"` for a QA verdict, or `"done"` for a closing summary. This documents the existing routing; it does not change it.

Comment-create receipts retain `routedTo`, `url` and either `activity` or `comment`. They also return `visibleToPeople: false` plus a resend `notice` for the log, or `visibleToPeople: true` for the comment thread.

### Blocker comment

In a ticket, select a comment and open its existing Commands palette (Ctrl+K, or long-press on a phone). **Mark as blocker**, beside **Pin comment**, gives it the same full 1px frame in red. **Unmark as blocker** removes the frame. Marking another comment replaces the previous marker; pinning remains independent.

The CLI-facing `POST /api/mcp/tasks/waiting-on` endpoint and MCP `hypertask_set_task_waiting_on` tool (consolidated `hypertask_tasks`, action `waiting_on`) accept:

```json
{ "taskId": 42, "userId": 7, "blockerCommentId": 101 }
```

Both fields are updated atomically. The person must be a board member, and the comment must belong to that ticket and not be an activity entry. Omit either field to preserve it; send both as `null` to clear both. A comment-only update or clear leaves the blocking person unchanged. Task reads and marker-write receipts expose `blockerCommentId`. Deleting the marked comment clears the marker automatically.

This is the app repository's API/MCP contract; native CLI argument parsing lives in the separate CLI repository. The ticket switch `htpr-7724-blocker-comment` defaults to Owner + QA because it can move a ticket to Trash. Switching it off hides the new action/frame and refuses marker writes, without changing existing person-only app writes or the separate `htpr-7723-task-waiting-on` switch.

### Archive or delete a ticket

`POST /api/mcp/tasks/archive` and `POST /api/mcp/tasks/delete`, with the MCP tools `hypertask_archive_task` and `hypertask_delete_task` (consolidated `hypertask_tasks`, actions `archive` and `delete`), take one identifier: `task_id`, `ticket_number`, or `project_id` with `unique_index`.

Archive does the same write as Archive in the app: the ticket leaves the board and stays in Archive. Delete does the same write as Delete in the app: the ticket and its sub-tasks move to Trash, `permanentlyDeleteAt` is 30 days out, and the ticket can be restored from Trash until then. Both answer `{ "success": true, "task": { "id", "ticketNumber", "projectId", "status", "archivedAt", "permanentlyDeleteAt" } }`.

A read-only agent, or an agent without write access to the ticket's board, is refused; a ticket on another board answers 404. The ticket switch `htpr-8215-agent-archive-delete` defaults to Owner + QA because it can move a ticket to Trash. Switching it off makes both endpoints answer 404 without changing archive or delete in the app. The native CLI commands live in the separate CLI repository.

## Connected-agent skill templates

Ticket get (`hypertask tasks get --json` / `hypertask_tasks` action `get`), task context, comment reads and comment-create receipts include `skill_context`: matched `active_skills` with full bodies, a one-line `summary`, and policy-bounded `instructions`. These fields also survive concise MCP formatting. `/deeper` in a comment therefore supplies the readable, enabled `deeper` skill to the connected agent; the server supplies a template, not model execution or permission to run commands. No separate CLI command or MCP tool is required.

Trigger phrases are read from a skill body's explicit `trigger phrases ...:` declaration or `# Triggers` heading, followed by one phrase per line (plain or bulleted). The list ends at a blank line, a new heading, or `When triggered`. Matching ignores case and rich-text markup and requires phrase boundaries. Only declared triggers and `/slug` tokens match, not arbitrary prose in the skill body. Board skills take precedence over personal skills with the same slug.

Matching is request-local: ticket get examines its title, description and latest 20 non-activity comments; task context examines its returned ticket and comments; comment reads examine the returned non-activity comments; creation receipts examine the submitted text. The summary does not claim a persistent agent session mode. Disabled skills never activate and list/get explicitly return `status: "disabled"` (or `"enabled"`) alongside `enabled`. Existing board access, personal ownership and team-bound credential restrictions still apply; this does not widen access to account-global skills.
