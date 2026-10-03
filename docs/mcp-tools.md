# MCP tools: consolidated catalog

Scope: sections 1, 2 and 3 of https://app.hypertask.ai/detail/project-15/6804. Golden task data is supplied for the separately owned harness.

## Rollout and compatibility

`htpr-6804-mcp-tools` is checked server-side for the authenticated principal, with the existing **Owner + QA** default. It does not enable itself for everyone. Flag off preserves the current tool definitions and deferred discovery behavior exactly. This checkout has **74** resource tools, not the ticket's historical 73; the current HTTP catalog also advertises `hypertask_search_tools` and `hypertask_describe_tool`, for **76** entries. `tests/fixtures/mcp-6804/legacy-catalog.json` freezes that flag-off list.

Flag on advertises **20** resource tools for a full human credential, without deferred meta-tool advertisements. Read-only or management-only credentials see only authorized resources and action enums. Managed agents do not see human-only profile or account administration actions; team-scoped management keys do not see account-wide connections or tokens. Existing REST authentication, board membership, ownership, team boundaries and permission checks remain authoritative.

All 74 existing resource names plus both discovery names remain callable for clients with cached definitions. Hidden aliases forward the original arguments, bearer credential and invocation identity to the same existing implementation. The existing `hypertask_time` name is already consolidated; it accepts the previous flat arguments as well as the new nested input and returns the new envelope when enabled. Other aliases preserve their original response text and add structured content for JSON results. Turning the flag off intentionally removes new names from the advertised/callable catalog; clients should refresh discovery after a flag change.

## Usage inventory and resource decisions

There is no reachable **30-day** per-tool usage query or stored transcript source in this checkout. `src/lib/mcp-server/utils/logger.ts` emits invocation records to **stderr**. `mcpSseAnalytics.ts` measures transport usage, while CLI telemetry and AI usage records are not per-tool MCP call counts. No production database or external log credentials were used. This is a resource-based inventory, not a claim about usage frequency. Revisit the grouping after the separately owned eval harness produces transcripts.

Group operations that use the same identifiers, authorization and workflow context: ticket create/read/update/move/assign, comment CRUD, board administration, page CRUD/history, view CRUD, skill CRUD/import and timer controls. Keep distinct resources for columns, labels, custom fields, inbox notifications and attachments so destructive or specialist actions are not confused with ticket edits. Keep search separate from known-ticket retrieval, account orientation separate from board lists, credentials separate from agent identities, and outbound webhooks separate from identity administration. Reports, decisions and drafts are distinct persisted document workflows. Action enums disambiguate within each resource, rather than advertising a tool per endpoint. No endpoint or existing business implementation is replaced.

## Input, descriptions and output

Each advertised tool has four labeled prose parts: **Does**, **Use when**, **Do not use when**, **Parameters and caveats**. One JSON file per tool lives in `src/lib/mcp-server/config/descriptions/`; the shared `parameters.json` supplies meanings where the existing parameter schemas omitted descriptions. Each action branch has the existing nested schema, with clearer spellings such as `user_id`, `view_id`, `section_id`, `member_identifier` and `task_identifier`. These are translated at the MCP boundary, not in REST. Task create/update and board manifest/create have schema-checked `input_examples`.

New calls use `{ action, input, response_format?, limit?, offset? }`. Reads default to `response_format: concise`, `limit: 20` (maximum 50), `offset: 0`. Ticket summaries expose `id`, `ticket`, `title`, workflow `status`, `assignee` and `due`; list endpoints that only know an assignee count cannot invent names. `detailed` retains original fields, including document content, but still bounds collections. Search evidence retains source identifiers and passage text. Writes always preserve detailed receipts, one-time credentials, partial upload outcomes and retry guidance.

Every advertised tool supplies an object `outputSchema` and returns matching `structuredContent` plus a text JSON representation. The envelope is `{ data, response_format, pagination? }`. Existing endpoint limits, offsets and cursors are forwarded when supported. Otherwise collections are sliced locally; use top-level offset for the next window. Limit-only endpoints fetch the skipped prefix as well as the requested window, without exceeding their own row caps; narrow the query when that cap is reached. Nested resource collections are capped too; their truncation asks for targeted follow-up reads rather than claiming a resumable global page. Document nodes, decision options and view configuration arrays are not result collections and remain intact, regardless of limit or offset. Response pagination retains upstream cursors, reports continuation and recommends many small targeted searches. Detailed mode changes field richness, not the row cap. Detailed text bodies are not cut mid-document. Concise help/document hits with source URLs keep a 2,000-character excerpt and explicitly request detailed mode when truncated.

For the new catalog, invalid arguments, unsupported actions, authorization failures, returned `Error:` strings, JSON failure objects and thrown execution errors produce `isError: true` tool results. Malformed JSON-RPC still uses protocol errors. Validation names the field and explains how to change it; for example, `project_id is required when unique_index is given; pass the project id or use ticket_number`. Permission errors request the proper credential and board membership; transient errors warn callers to inspect writes before retrying. Internal exception details and credential-looking strings are not echoed. Flag-off protocol and response behavior remains unchanged.

HTTP and existing legacy SSE share catalog selection and the flagged output/error behavior. Only the response bindings change; transport, OAuth, annotations and Directory work belong to https://app.hypertask.ai/detail/project-15/6478. The eval harness and CI integration belong to https://app.hypertask.ai/detail/project-15/6505; `tests/fixtures/mcp-6804/golden-tasks.json` contains 25 seeded, realistic tasks as data only. Run mutating tasks only against an isolated fixture environment, never production or shared previews. Chat tool extraction belongs to https://app.hypertask.ai/detail/project-15/6506 and can consume this catalog later; it is not changed here.

## Complete resource inventory

| Advertised tool | Actions | Existing implementation names |
| --- | --- | --- |
| `hypertask_custom_fields` | `list`, `set` | `hypertask_list_custom_fields`, `hypertask_set_custom_field_value` |
| `hypertask_time` | `start`, `stop`, `status`, `running`, `report`, `log`, `pause`, `resume` | `hypertask_time`, `hypertask_pause_timer`, `hypertask_resume_timer` |
| `hypertask_sections` | `list`, `get`, `create`, `update`, `delete` | `hypertask_section` |
| `hypertask_attachments` | `attach` | `hypertask_attach_files` |
| `hypertask_decisions` | `create`, `list`, `get`, `answer`, `cancel` | `hypertask_decision_request` |
| `hypertask_views` | `list`, `get`, `create`, `update`, `delete`, `switch` | `hypertask_list_views`, `hypertask_get_view`, `hypertask_create_view`, `hypertask_update_view`, `hypertask_delete_view`, `hypertask_switch_view` |
| `hypertask_tasks` | `list`, `get`, `context`, `tree`, `next`, `versions`, `restore`, `link`, `links`, `unlink`, `create`, `update`, `move`, `assign` | `hypertask_list_tasks`, `hypertask_get_tasks`, `hypertask_task_context`, `hypertask_get_task_tree`, `hypertask_next_tasks`, `hypertask_task_description_history`, `hypertask_link_tasks`, `hypertask_create_task`, `hypertask_update_task`, `hypertask_move_task_between_boards`, `hypertask_assign_user` |
| `hypertask_tokens` | `mint`, `revoke` | `hypertask_mint_token`, `hypertask_revoke_token` |
| `hypertask_webhooks` | `get`, `configure`, `test`, `replay`, `rotate`, `delete` | `hypertask_agent_webhook` |
| `hypertask_skills` | `list`, `get`, `create`, `update`, `delete`, `import` | `hypertask_list_skills`, `hypertask_get_skill`, `hypertask_create_skill`, `hypertask_update_skill`, `hypertask_delete_skill`, `hypertask_import_skills` |
| `hypertask_agents` | `list`, `presence`, `create`, `revoke`, `archive`, `delete` | `hypertask_list_agents`, `hypertask_agent_presence`, `hypertask_create_agent`, `hypertask_revoke_agent`, `hypertask_archive_agent`, `hypertask_delete_agent` |
| `hypertask_comments` | `list`, `add`, `update`, `delete` | `hypertask_get_comments_for_task`, `hypertask_add_comment_to_task`, `hypertask_update_comment`, `hypertask_delete_comment` |
| `hypertask_user_context` | `hello`, `get`, `profile`, `connections` | `hypertask_hello`, `hypertask_get_user_context`, `hypertask_update_profile`, `hypertask_list_connections` |
| `hypertask_pages` | `create`, `get`, `update`, `list`, `search`, `versions`, `restore`, `archive` | `hypertask_create_page`, `hypertask_get_page`, `hypertask_update_page`, `hypertask_list_pages`, `hypertask_search_pages`, `hypertask_page_history` |
| `hypertask_reports` | `list`, `get`, `create`, `update`, `delete` | `hypertask_report` |
| `hypertask_projects` | `list`, `manifest`, `playbook`, `create`, `rename`, `members`, `archive`, `invite_member`, `get_playbook`, `set_playbook`, `get_instructions`, `set_instructions` | `hypertask_list_projects`, `hypertask_board_manifest`, `hypertask_get_board_playbook`, `hypertask_create_board`, `hypertask_rename_board`, `hypertask_list_project_members`, `hypertask_project_admin`, `hypertask_board_config` |
| `hypertask_inbox` | `list`, `archive`, `unarchive`, `move_task` | `hypertask_inbox_list`, `hypertask_inbox_archive`, `hypertask_inbox_unarchive`, `hypertask_move_task_to_inbox` |
| `hypertask_labels` | `list`, `create` | `hypertask_list_labels`, `hypertask_create_label` |
| `hypertask_search` | `tasks`, `semantic`, `related`, `help` | `hypertask_search_tasks`, `hypertask_rag_retrieval`, `hypertask_find_related_tasks`, `hypertask_search_help_docs` |
| `hypertask_drafts` | `create`, `list`, `update`, `publish`, `delete` | `hypertask_draft` |
