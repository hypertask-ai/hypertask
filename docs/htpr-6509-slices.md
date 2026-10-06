# Task API consolidation: slices

Ticket: https://app.hypertask.ai/detail/project-15/6509

Type: `[REFACTOR]`. No product behavior change or feature flag. Baseline commit: `33c5a4ad1a05b375185b42a6c1bd7b7115d63514`.

## Slice 1: task route helpers and task-list batching

Shipped in PR #1026 (`dd6ed1827`). The following evidence describes that slice, not new work in slice 2.

### Changed operations and compatibility

| URL | Methods | Preserved contract |
| --- | --- | --- |
| `/api/tasks/{taskId}/description-versions` | GET | `{ current, hasMore, versions }`, actor names and fallbacks, 100-version limit, existing 400/401/404/500 error bodies |
| `/api/tasks/{taskId}/description-restore` | POST | `{ ok, restored_from_version }`, existing JSON validation messages, 400/401/404/409/500 responses, controller status/message passthrough, optimistic description lock and broadcasts |
| `/api/tasks/cycle` | GET, POST | Existing history/assignment/clearing responses, pagination and search, strict database-ID range, existing 400/401/404/409/500 bodies and broadcasts |
| `/api/tasks/getAll` | POST | Existing array/string/message responses, 401 and 405 message keys, 200 empty-list error fallback, full nested task/user payload |

The same `loadCurrentUser` entry point now serves all three current App Router task routes and the legacy list route. Identity always comes from `getSessionUser`, retaining Better Auth and signed legacy session handling. Description endpoints still require the existing profile cookie and keep its actor fields, including notification preference. Their profile must match the session, an invariant already enforced by the existing `/api` proxy. This does not move authentication responsibilities out of that proxy or change its rejection responses.

`taskAccessWhere` centralizes the existing predicates without a second task lookup. Description routes retain team scoping and Normal project status without adding a task-status restriction. Cycles retain Normal task/project status and the write/content policy that permits owned teamless boards. Existing `userCanAccessTask` and `userCanAccessTaskContent` callers use the same predicate while retaining their unrestricted project-status behavior.

POST routes use the existing `readJsonBody` implementation with optional error-response callbacks. MCP callers without callbacks keep exactly their current field-error bodies. Shared `jsonError` and `unauthorized` helpers preserve the task routes' existing `{ error }` shape; the legacy list keeps `{ message }`. There is no envelope rollout or new 403 convention. Shared integer parsing retains strict path parsing, the cycle integer ceiling, and the restore endpoint's existing numeric-only version-ID range.

## Query evidence

The default Prisma singleton forces relation-loading reads to the `query` strategy. The legacy list opts into `join`, loading the same nested relations through one PostgreSQL statement rather than separate relation queries.

`node --test tests/task-route-consolidation-scope.test.cjs` runs the actual generated Prisma SQL planner with a synthetic driver adapter. The adapter cannot write and never opens a database connection. It supplies a populated task, parent, subtask, assignee/user, comment and notification fixture. Both strategies are decoded by Prisma and compared as serialized JSON; original selection, ordering and visibility filters are pinned.

| Operation | Before | After | What is measured |
| --- | --- | --- | --- |
| Legacy `getAll` populated fixture | 8 SQL adapter calls | 1 SQL adapter call | Real Prisma planner, `query` versus `join`, identical JSON |
| Description versions | 2 data lookups without agents, 3 with agents | Same | Access lookup, version list, optional single batched agent lookup; already batched at baseline |
| Description restore | 2 reads before the mutation service | Same | Access lookup and task-scoped snapshot lookup; no extra access query |

Counts exclude session resolution, mutation-service internals and broadcasts. Better Auth session resolution can add its existing adapter lookup to description routes now that they use the shared signed-session loader. There is no production latency, query-plan cost or large-board benchmark claim. Full parent/subtask scalar rows and full assignee user rows are intentionally retained because narrowing them changes the public JSON contract.

## Duplicate inventory

This worktree has three App Router task route files and 33 Pages Router task route files. None has a same-URL twin. No Pages route is deleted, no caller URL is changed, and no new App Router operation is invented. In particular, cycle assignment is not equivalent to the legacy `single` mutation, and restoring a description is not equivalent to recovering a deleted task.

## Completed ticket portions

- Section 2, task portion: shared access predicate applied to the three current App Router task routes and both existing task-access helpers; one signed current-user loader at these route entry points.
- Section 3, task portion: shared JSON-body reading, integer parsing and legacy-compatible error responses applied to the current App Router task routes.
- Section 6, legacy task-list portion: nested relation round trips reduced from 8 to 1 for the populated synthetic fixture without removing response fields.
- Section 1, eligible-twin audit: complete for `src/pages/api/tasks`; zero eligible migrations in this checkout.

No numbered section of the entire ticket is fully complete.

## Remaining work after slice 2

1. Section 1: remaining Pages task operations, project/section/notification writes, caller migrations and the MCP service adapter after the separate service-layer work. All 33 Pages task files remain.
2. Section 2: remaining route-entry loader adoption, project access promotion and domain interfaces, and other inline task-access checks. The existing task-access helpers already had production callers before slice 1.
3. Section 3: remaining REST JSON readers, page-ID parsers, team membership callers, webhook signature sharing and rate limiting. Slice 2 only adopts the existing current-user and unauthorized-response helpers on its one touched GET route; it has no request body to parse.
4. Section 4: dead endpoints, external-only route organization and coordination with the separate response-envelope rollout. No dead endpoints are removed here.
5. Section 5: session-list pagination/body removal needs a caller/compatibility migration, not a query-only change. Page-route access lookups remain separate. Agent slug resolution still requires the full owned-name set to preserve collision suffixes; guest cleanup, skill payloads and login self-HTTP need separate review. Tree ancestors, breadth-wise subtree loading, narrowed favorites/user/page selections and time-report admin batching already existed at the slice-2 baseline; see the inventory below.
6. Section 6: retiring `/api/projects/detail` in favor of `getBoardTasks` changes the response shape and requires caller migration. The obsolete `src/pages/api/projects/detailHelper.ts` is already absent. Comment fan-out and archived-count grouping already existed at baseline; neither is rewritten here. Legacy parent/subtask payload narrowing needs a separately reviewed compatibility plan, since those full fields remain in the public JSON.
7. Section 7: Zod/OpenAPI-derived typed client and frontend adoption after schema conventions land.

The task-open loaders, app-shell bootstrap, `src/app/api/mcp` and `src/lib/mcp-server` are untouched. Only the shared MCP JSON-body helper receives an optional callback argument; its default contract has regression coverage.

## Slice 1 verification

- Before implementation: `node --test tests/task-route-consolidation.test.cjs`, 16 passed, 0 failed. The same contract assertions are run after implementation.
- Regression commands and gate evidence are in `GATES.md`. The expanded run includes task-cycle, description-history, malformed MCP JSON, session resolution, cookie identity, property realtime, task-write choke points and task-single authentication tests.
- Full `npx tsc --noEmit -p .`: 15 unrelated diagnostics at baseline and after the change. The baseline native compiler used exit 2; the final default TypeScript 6.0.3 compiler used exit 1 after the shared dependency symlink changed externally. `tests/task-route-typecheck.cjs` reruns that exact command, accepts both compilers' diagnostic exit codes, and rejects any diagnostic not present in the baseline or unexpected compiler stderr. No changed production file has a diagnostic.
- `npm run lint` is scoped with ignore/unignore patterns to every changed TypeScript/CJS file; `git diff --check` checks whitespace.
- No full Next build or database-backed/live QA is claimed. The build script runs production migrations, which are outside this worktree-only, no-shared-state task.

## Slice 2: relation-read batching

Baseline: `dd6ed1827` (production including slice 1). Sections 5 and 6 gain five explicit Prisma `relationLoadStrategy: "join"` read opt-ins. The singleton otherwise defaults to `query`, so nested relations previously required separate SQL adapter calls. No columns, relation filters, limits, ordering, URLs, statuses or JSON keys are removed or added. No flag is required for identical-output performance work.

### Changed operations and measured query counts

| Operation | Before | After | Preserved contract |
| --- | --- | --- | --- |
| `/api/ai-chat/all-sessions` GET | 4 | 1 | `{ success: true, sessions }`, all message bodies, attachments, agent author names, external-agent exclusion, updatedAt/message ordering, empty-list session creation, existing 401/500 bodies |
| `getFavoritesForUser` | 6 | 1 | Ordered favorites with the same selected project, owner, member, user and public-agent fields |
| `getUserById` | 2 | 1 | Existing selected user fields plus full UserSetting, including null profile and error fallback |
| `getPage` | 3 | 1 | Page scalars, the same five task fields and child-page projection; missing page stays null |
| `/api/projects/detail` POST controller | 7 | 1 | Full project/task/assignee/user scalars, visible sections in ranking order, owner and custom instructions; existing 400/200 bodies |

Counts are real generated-Prisma SQL planner adapter calls for populated synthetic fixtures, not live database measurements. `tests/htpr-6509-query-contracts.json` pins the existing selections and serialized bodies; the test runs the exact same production reads with the old `query` strategy and the new explicit opt-in, decodes both through Prisma and compares them with the pinned contract. The adapter rejects writes and never connects to a database. The fixtures include messages/attachments, agent authors, favorite members/users/agents, page children and board tasks/assignees/sections. Empty/missing roots and session creation/failure responses are tested separately.

The session route adopts `loadCurrentUser(request.headers, true)` and `unauthorized()`. It retains the legacy profile precondition and profile identity, now using the same signed-session loader as slice 1. Requiring the profile to match the signed session repeats the existing `src/proxy.ts` API invariant, rather than changing public API authentication policy. Better Auth resolution can add its existing session-adapter lookup; the table excludes authentication and the unchanged empty-list creation path. The other four opt-ins only change controller read strategy; their entry-point authorization is untouched.

### Already present at baseline, not claimed as slice-2 fixes

- Comment human fan-out uses one replay dedupe read, batched mutes/reminders and createMany per chunk of ten under the existing task-inbox lock. Agent fan-out uses batched dedupe and createMany. Reminder invocation, broadcasts and replay behavior remain untouched. Existing fan-out/mute regression tests pass.
- Archived inbox metadata already uses GROUP BY on (type, taskId), one task-to-board lookup and the existing access recheck. Its three regression tests pass.
- AI task-tree ancestor lookup already uses a bounded recursive query plus one access query. Subtrees already load breadth-wise, one query per level, not two queries per node. A single-query authorized subtree remains a possible follow-up, but is not necessary for this relation-read slice.
- Time reports already precompute admin project IDs. Favorite/user/page field narrowing also already existed. None is counted as new slice-2 work.
- `getBoardTasks` has a different projected/hydrated client contract from legacy project detail. Replacing the latter with the former would violate this slice's identical-JSON constraint.

### Slice 2 verification and limits

- Before production edits: `HTPR_6509_BASELINE=1 node --test tests/htpr-6509-query-batching.test.cjs`, 12 passed, 0 failed. Baseline capture switches were removed afterward so normal tests cannot rewrite the fixture or disable batching assertions. A fixture bug in child-page SQL matching was corrected during final verification.
- After edits: `node --test tests/htpr-6509-query-batching.test.cjs`, 14 passed, 0 failed, including two signed-session identity invariant checks added after helper adoption.
- Existing regressions: 88 passed, 0 failed across the 11 CJS files enumerated in `GATES.md`.
- `node tests/task-route-typecheck.cjs` invokes full `npx tsc --noEmit -p .`: baseline and final both have the same 15 pre-existing diagnostics, 0 new, compiler exit 2. This is baseline parity, not a clean full-project typecheck.
- `npm run lint` with ignore/unignore patterns covering every changed TS/CJS file passes. `git diff --check` passes.
- No build, live QA, database-backed query-plan/latency measurement, push, PR or board write is performed. The build script includes production migrations and is outside this local-only task. Large/unbounded JSON payloads are intentionally retained, and join cost at production scale remains unmeasured.

## Slice 3: remaining eligible hot-path reads and page authorization

Baseline: `fb9ef851b6bb3a5b8ef84d2425df5a6f7d19ac3b`, production including slices 1 and 2. Type: `[REFACTOR]`, identical public behavior, no flag. Only this worktree and its existing `htpr-6509-s3` branch are used. No URLs, methods, status codes, JSON projections, authentication policy, mutation arguments or notification/indexing behavior are intentionally changed.

### Changed operations and query evidence

| Operation | Before | After | Measurement and preserved contract |
| --- | --- | --- | --- |
| AI tree, 50-node chain, unlimited depth | 51 | 2 | Production helper delegate calls: root lookup and one recursive subtree query with statement-time board authorization; exact serialized tree and key order match |
| AI tree, 50-node four-level fixture | 5 | 2 | Existing tree regression fixture; archived children, deleted/inaccessible subtree pruning and depth-limit omission of `children` remain unchanged |
| AI tree, depth 0 / depth 1 | 1 / 2 | 1 / 2 | Existing shallow-query paths retained; ancestor lookup remains its existing two reads |
| Page GET, PATCH, versions, archive and restore access preflight | 2 | 1 | Actual page service and routes against the same isolated store; page projection, 401/404 bodies, conflict/validation errors and mutation arguments match baseline |
| `listReport` populated entry relations | 4 | 1 | Generated Prisma SQL planner adapter calls, with identical decoded JSON, access/filter arguments, 1000-row limit, ordering and `canManage` behavior |
| Agent detail selected agent/membership/board/team read | 4 | 1 | Generated Prisma SQL planner adapter calls with identical selections and decoded relation JSON; other detail reads are unchanged |
| Agent PATCH using an owned canonical UUID | 3 | 2 | Scalar ownership/slug read delegate calls, excluding the update; no initial full owned-name list, still one fresh collision-safe slug calculation after mutation |
| Guest board owner safety check | 2 | 1 | Generated Prisma SQL planner adapter calls plus actual guard/delete-order contract comparison; task enumeration and all ordered deletes are unchanged |
| Email-code login refreshed User/UserSetting/UserPicture | 3 | 1 | Generated Prisma SQL planner adapter calls; full response, cookie values, missing-user fallback and side-effect order match baseline |

The recursive subtree query evaluates the human `getProjectWhere` policy within its own statement: a non-null team and either ownership or a human membership. It does not trust preloaded board IDs after ownership or membership is revoked. It filters access and Deleted status at every recursive edge, so an accessible grandchild behind a denied or deleted parent cannot appear. Archived child tasks and a Deleted root retain their existing treatment. A bigint depth parameter preserves valid depth values above the PostgreSQL integer range. The original ancestor cycle/access/depth errors are unchanged.

Page lookup accepts an optional authenticated `userId` and combines the same Normal-project, team-scoped task predicate with the unique page lookup. `taskAccessWhere` can omit the task ID when used on the page's task relation. All five operations across the four touched route files use this predicate instead of a second task query. Calls without `userId`, including existing MCP consumers, keep exactly their old selection and unfiltered service contract. Existing cookie/profile authentication is intentionally retained here. No write/access policy is widened to teamless or archived boards, and no new task-status restriction is added.

Agent UUID fast lookup still checks `userId`. It falls back to the full name resolver on a miss, preserving UUID-shaped slugs, suffix collisions, trimmed IDs, case-sensitive ID matching and existing 404s. Slug-based PATCH still loads names before and after a rename; the second read is not redundant because names may have changed. Unknown UUIDs can incur one extra lookup before the preserved slug fallback.

### Named-hot-path audit and remaining work after slice 3

- Section 5 tree: ancestor batching was already present. This slice replaces breadth-wise subtree round trips with one authorized recursive subtree read after the root lookup. Depths 0 and 1 stay at their existing budgets. A leaf requested at depth 2 or unlimited depth retains the former two-read budget; no universal latency improvement is claimed.
- Section 5 sessions and bootstrap: slice 2 already batched session lists, favorites and user settings. They are rechecked, not changed again. Pagination, dropping message/skill bodies, or removing full user fields changes JSON and requires a separate compatibility/feature migration. The optimized app-shell bootstrap and task-open loaders remain untouched.
- Section 5 pages: duplicate access preflights removed on every route that called `getPage`; existing projected task fields remain for service consumers. Create/list/search access and parsing remain separate Section 2/3 work.
- Section 5 time reports: admin-project batching already existed. Only the remaining nested entry relations are batched here.
- Section 5 agents: detail relations and canonical-ID PATCH preflight improved. Full owned-name sets remain necessary for slug collision suffixes. Slug PATCH and DELETE name resolution retain their existing contract; UUID DELETE optimization is not claimed.
- Section 5 guests: the cron already processes four independent guests concurrently. This slice only consolidates the board-owner guard. Destructive cascade order, retry behavior, scoping and the cron response are unchanged; cross-guest bulk deletion is not attempted.
- Section 5 skills: GET returns full skill rows, including bodies. There is no duplicate nested read to remove without changing that public payload, so the route is untouched.
- Section 5 login: only the refreshed-user relations are batched. The self-HTTP call has no session cookie, while `/api/projects/getAll` requires one. Replacing it with a controller call would populate `prevBoard`, alter redirects and add `previousBoard` cookies where the current request gets none. That repair is deliberately deferred as a behavior change; full refreshed user fields are also part of the response.
- Section 2: page access is consolidated on the four touched routes using the slice-1 predicate. Broader project-access promotion, domain interfaces, remaining inline task checks and route-entry loader adoption are still open.
- Sections 1, 3, 4, 6 and 7: no additional completion beyond slices 1 and 2 is claimed. Migration, parser/membership/rate-limit rollout, dead/external endpoints, legacy board/detail caller changes and generated client work remain as listed above. The separate service-layer and envelope efforts still own their respective MCP and response conventions.

No entire numbered section is complete. Eligible identical-output reads have been improved, not the ticket's proposed pagination or field-removal behavior.

### Slice 3 verification and limits

- Before production edits: `node --test tests/htpr-6509-s3-contracts.test.cjs`, 27 passed, 0 failed. The final suite retains those contracts and compares current production modules against frozen synthetic results and query arguments captured by executing the pinned baseline modules. Normal tests do not rewrite fixtures or require Git history, so shallow CI checkouts work; derived cookie expiry timestamps are normalized while values and Max-Age remain pinned. Later-added ownership edge cases and real Prisma relation fixtures expand the final suite to 37 passed, 0 failed.
- Existing regressions: 80 passed, 0 failed across the ten CJS files enumerated in `GATES.md`, covering slices 1/2, shared task access, guest cron, agent ownership/credential lifecycle, login security and time-report permissions.
- `node --import tsx tests/chat-task-tree.test.ts`: passed, including the existing ancestor error and 50-node fixtures.
- `HTPR_6509_S3_SQL=1 node --test tests/htpr-6509-s3-sql.test.cjs`: 1 passed, 0 failed, 0 skipped. The actual emitted CTE executes against a disposable PostgreSQL 16 container with synthetic Task rows, proving depth limits, large depth values, SQL syntax, archived children, NULL sibling ordering and denied/deleted-parent pruning. The container is automatically removed; no live database is accessed.
- Full `npx tsc --noEmit -p .`, invoked by `node tests/task-route-typecheck.cjs`: baseline and final have the same 15 pre-existing diagnostics, 0 new, compiler exit 2. This is baseline parity, not a clean project-wide typecheck.
- `node tests/htpr-6509-s3-verify.cjs lint` invokes `npm run lint` with ignore/unignore patterns covering all 15 changed TS/CJS files. It passes. The scope oracle pins this worktree/branch, checks all 18 changed paths against an explicit allowlist, exercises negative controls and runs `git diff --check`.
- Verification uses the available Node v22.22.2 runtime. CI targets Node 24; that runtime is not installed here, so Node-24 execution is not claimed.
- No build, live QA, production query-plan/latency benchmark, push, PR or board write is claimed. The build command includes production migrations, so it is not run. SQL count evidence for relations is synthetic generated-planner evidence, not production performance data. Deep-tree reads preload authorized board IDs; large board sets, subtree sorting and relation-join costs remain unbenchmarked.

### Honest remaining-slice estimate

These are planning ranges, assuming roughly forty changed files per slice and existing endpoint/JSON compatibility. They are not completion commitments.

| Section | More slices estimated | Basis and dependencies |
| --- | --- | --- |
| 1: migrate remaining writes | 6-9 | The checkout still has 33 task, 26 project, 7 section and 17 notification Pages files, including reads. Used-write migrations require App routes, legacy removal and contract tests, plus service integration after the separate MCP effort; dead-route ownership remains separate |
| 4: dead/external endpoints and envelope coordination | 2-3 | One safe dead-endpoint/caller audit/removal slice, one external-route organization/compatibility slice, and potentially one coordination cleanup after the envelope conventions land |
| 7: generated typed client with task callers consuming it | 3-5 | Schema/OpenAPI generation, client/runtime error compatibility, then task-caller adoption and regression coverage after the separate schema/envelope effort. Moving every remaining frontend fetch would add further slices beyond this minimum acceptance criterion |

## HTPR-6923: remaining Pages Router migration

Ticket: https://app.hypertask.ai/detail/project-15/6923. Baseline: `fdb5e4e4c84d906dc061b51811b5a80179aa5192`. This section supersedes the historical no-flag assumption **for this migration only**: Valentin requires server flag `htpr-6923-app-router-writes`, registered in `src/lib/flags.ts`, using the existing `DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA"`. No flag mode is changed by this work.

### URL ownership and compatibility design

Slice 1 keeps `/api/tasks/single` and `/api/tasks/moveTask` owned by Pages Router; no conflicting `src/app/api/tasks/{single,moveTask}/route.ts` is installed. Their default export dispatches **PUT only** after resolving the signed session and checking the flag for that session's user ID. Off, unauthenticated, or a flag-lookup outage calls the original handler; its complete body is byte-pinned and unchanged. Other methods bypass even the flag lookup. Body/cookie-supplied user IDs never choose the cohort. Flag checking adds read-only preflight work for PUT; it does not change the old handler's own authentication or authorization.

On calls shared Web-request handlers in `src/lib/api/task-writes/{update,move}.ts`, via `taskWriteRoute` (authentication, compatibility Zod schemas, legacy validation order and error bodies). The narrow request interface accepts App Router `Request` directly; Pages passes its already-parsed body without a second JSON parse or serialization. Zod deliberately implements the existing truthiness requirements, retains unknown update fields and does not tighten accepted types. Null/missing bodies keep the old 500, not a new validation envelope. Update's required-field check precedes authentication; move's authentication and actor lookup precede validation, as before.

Both paths use the existing shared `updateTaskSingle` mutation choke point, preserving board permissions, agent ownership, transactions, activity, leases, indexing, webhooks and notifications. Route-specific description-reference work, move activity/notification callbacks and realtime broadcasts retain their order and failure policy. Flag-on never retries legacy after loading/executing the operation, since a failed response could follow a committed write. No user-facing UI or frontend helper changes are necessary: the URLs, verbs, statuses and JSON stay the same.

The operations extracted by https://app.hypertask.ai/detail/project-15/6478 live in `src/lib/mcp/operations/`; their MCP task payloads and error envelopes differ from the Pages contracts. Do **not** invoke MCP HTTP handlers as replacements for legacy REST or broaden their auth to accept cookies. Slice 12 owns a service adapter using those in-process operations and request-local authenticated context, retaining each surface's input/output mapping. This slice already shares their underlying mutation choke point, not their transport contract.

For later physical router transfers, extract the original Pages implementation verbatim to `src/lib/api/task-writes/legacy/` (domain-equivalent directories for projects/section/notifications), then install the App route at the **same URL**, deleting its Pages twin in the same change. The off branch adapts App input to that preserved implementation, including query arrays, cookies, headers, response status/JSON and any response headers. Streaming/multipart/configured upload routes need their own adapter and explicit tests, not the JSON wrapper. Apply this per endpoint within its domain slice; never put the entire ownership transfer into one oversized final PR. Slice 12 transfers the two slice-1 owners once this adapter is proven. The legacy implementation cannot be deleted while Off must still run it. Removing the flag/old branch after release is a separate owner-approved follow-up, not part of this ticket's compatibility promise.

### Whole-ticket plan: 12 slices

The inventory below assigns every existing file exactly once to its primary domain slice (33 task, 26 project, 7 section and 17 notification files = 83). Mixed GET/write files retain their reads until their ownership transfer; POST does not necessarily mean a write. These are scope boundaries, not a claim that every group fits 800 lines: split a domain group further if its implementation exceeds that budget.

| Slice | Scope and caller work |
| --- | --- |
| 1 (this change) | PUT task update and in-board move: `single.ts`, `moveTask.ts`; shared Web handlers, Zod-compatible wrapper, server flag and old/new contract tests. No URL/caller changes. |
| 2 (local implementation; not shipped) | https://app.hypertask.ai/detail/project-15/6968 covers `create`, `createGlobally`, `(un)archive`: shared Web handlers, unchanged legacy fallback, fullscreen/global variants and queue/inbox effects. Creation's unresolved-section/no-response branch stays unchanged. **Slice 2b:** `recoverTask`, `deleteTask` remain untouched to keep this change PR-sized. |
| 3 | Task schedule, parent/relation, waiting-on, description reaction and PR linking writes. Preserve task-update pipeline and public JSON; handle zero-caller PR endpoint as below. |
| 4 | Task attachments: signed upload URL, finalize, n8n upload and download. Preserve upload limits, body-parser/multipart configuration, streaming headers and external URL contracts. |
| 5 | Remaining task reads, markRead and cross-board move. Also transfer `single`'s retained GET/DELETE with their original contracts; do not narrow parent/subtask fields. |
| 6 | Project core writes and remaining reads; preserve membership/owner policy. `projects/detail` is **reserved for the sibling compatibility ticket**, not changed here. |
| 7 | Project view create/update/delete/rename/switch/unsaved/reset writes; existing shared view UI and callers stay on their current URLs. |
| 8 | Project view order/default-order/smart-split writes and zero-caller sync-view review; preserve exceptional old status codes. |
| 9 | All seven section endpoints: four writes and three POST reads. Preserve ranking and board access; remove only proven-dead route shells after review. |
| 10 | Inbox/task-notification mutations (including GET writes), task-seen and follower email; preserve user scoping and realtime/inbox fan-out. |
| 11 | Notification preferences, matrix, splits and push status plus remaining notification reads. Review zero-caller mute without removing the shared mute model/services. |
| 12 | MCP service adapter atop the shared in-process operations from the service-layer ticket; transfer slice-1 URL ownership; final same-URL twin/dead-shell audit. Update direct imports of removed Pages modules to shared services. No MCP wrapper/auth cache or update-pipeline redesign. |

Caller migration in each slice means moving **server-side imports of Pages helpers** to their extracted operations and removing obsolete internal/self-HTTP wiring only when responses are proven identical. App frontend callers, native CLI and external integrations retain their old URLs and JSON. Frontend typed-client adoption is not this ticket.

Sibling exclusions: https://app.hypertask.ai/detail/project-15/6924 owns session paging, board detail and parent/subtask payload compatibility; https://app.hypertask.ai/detail/project-15/6925 owns the Zod/OpenAPI typed frontend client; https://app.hypertask.ai/detail/project-15/6926 owns MCP REST wrapping and cached auth; https://app.hypertask.ai/detail/project-15/6927 owns MCP tool annotations, task update pipeline and dead legacy MCP server. No files in those scopes change in slice 1.

### Dead-endpoint evidence and disposition

`node tests/htpr-6923-verify.cjs plan` scans tracked text source in `src`, **all tracked text in the native CLI repo** `/home/valentin/projects/hypertask-cli-zig` (observed HEAD `455ae8bf6ab094304f70ec1902d504e30880f104`), and `e2e`. It searches route-qualified paths, shortened paths and source imports, excluding only each route's own declaration. Exact route boundaries exclude prefix siblings such as createGlobally. A known live task-single URL and an injected dead-route caller prove the negative checker detects callers. Counts below are file references (including conservative controller/import/comment matches), not traffic measurements. Update/move are selected for their multiple interactive callers, not measured production traffic.

| Zero-caller route | src / CLI / e2e | Disposition |
| --- | --- | --- |
| `/api/tasks/getAll` | 0 / 0 / 0 | Slice 5: remove unused route shell once external-use review clears it; keep its shared controller until import audit passes. |
| `/api/tasks/linkPullRequest` | 0 / 0 / 0 | Slice 3: retain shared PR-link service/MCP operation; candidate to drop the unused Pages shell. |
| `/api/projects/detail` | 0 / 0 / 0 | Sibling compatibility ticket owns retirement; do not delete here even though static route callers are absent. |
| `/api/projects/views/sync-view` | 0 / 0 / 0 | Slice 8: candidate dead write; do not silently map its unusual 101 error to another status. |
| `/api/section/getAll` | 0 / 0 / 0 | Slice 9: candidate unused POST read. |
| `/api/section/getByTaskId` | 0 / 0 / 0 | Slice 9: candidate unused POST read. |
| `/api/notifications/mute` | 0 / 0 / 0 | Slice 11: candidate unused route, not proof that notification mute itself is dead. |

Zero tracked callers is not proof of zero unknown external use. No dead endpoint is removed in slice 1. Before removal, re-run the audit at the new base, inspect runtime/external support evidence and any route construction by interpolation (especially generic axios helpers using `"/api" + url` and route constants). Keep externally supported routes at identical URLs even without frontend callers. `n8nUpload`, download and signed-upload routes demonstrably have callers and are **not** dead. The unrelated dead MCP server stays with its sibling ticket.

### Per-file inventory

Counts are src / CLI / e2e; reads are included so none of the remaining 33 task files is silently omitted. Paths describe current files; domain slices create the corresponding shared operations and later same-path App owner.

| Current file | Primary slice | Disposition | Caller files (src / CLI / e2e) |
| --- | --- | --- | --- |
| `src/pages/api/notifications/(un)archiveBulk.ts` | 10 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/notifications/access.ts` | 11 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/notifications/changePushNotificationStatus.ts` | 11 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/getAll.ts` | 11 | Migrate / preserve contract | 9 / 0 / 0 |
| `src/pages/api/notifications/getAllInbox.ts` | 11 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/notifications/getByTask.ts` | 10 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/notifications/getCount.ts` | 11 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/notifications/getPushNotificationStatus.ts` | 11 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/markAsDone.ts` | 10 | Migrate / preserve contract | 5 / 0 / 0 |
| `src/pages/api/notifications/markAsUnseen.ts` | 10 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/matrix.ts` | 11 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/moveTaskToInbox.ts` | 10 | Migrate / preserve contract | 4 / 0 / 1 |
| `src/pages/api/notifications/mute.ts` | 11 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/notifications/preference.ts` | 11 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/sendEmailToFollower.ts` | 10 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/notifications/splits.ts` | 11 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/notifications/unArchiveNotificationById.ts` | 10 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/archive.ts` | 6 | Migrate / preserve contract | 2 / 1 / 0 |
| `src/pages/api/projects/boardTasks.ts` | 6 | Migrate / preserve contract | 4 / 0 / 4 |
| `src/pages/api/projects/create.ts` | 6 | Migrate / preserve contract | 5 / 0 / 2 |
| `src/pages/api/projects/delete.ts` | 6 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/projects/detail.ts` | 6 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/projects/getAll.ts` | 6 | Migrate / preserve contract | 14 / 0 / 2 |
| `src/pages/api/projects/getAllMinimal.ts` | 6 | Migrate / preserve contract | 10 / 0 / 0 |
| `src/pages/api/projects/getArchived.ts` | 6 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/getFavorites.ts` | 6 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/getFirst.ts` | 6 | Migrate / preserve contract | 5 / 0 / 0 |
| `src/pages/api/projects/lastActivity.ts` | 6 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/projects/leave.ts` | 6 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/removeMember.ts` | 6 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/setMemberRole.ts` | 6 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/update.ts` | 6 | Migrate / preserve contract | 5 / 0 / 0 |
| `src/pages/api/projects/views/create-view.ts` | 7 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/delete-rename-view.ts` | 7 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/reset-order.ts` | 8 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/reset-to-default.ts` | 7 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/set-default-order.ts` | 8 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/smart-split.ts` | 8 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/switch-view.ts` | 7 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/sync-view.ts` | 8 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/projects/views/unsaved-view.ts` | 7 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/projects/views/update-order.ts` | 8 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/projects/views/update-view.ts` | 7 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/section/create.ts` | 9 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/section/getAll.ts` | 9 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/section/getByTaskId.ts` | 9 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/section/getProjectSections.ts` | 9 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/section/rename.ts` | 9 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/section/resetRanks.ts` | 9 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/section/update.ts` | 9 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/tasks/(un)archive.ts` | 2 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/tasks/addParent.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/addRelations.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/create.ts` | 2 | Migrate / preserve contract | 3 / 3 / 5 |
| `src/pages/api/tasks/createGlobally.ts` | 2 | Migrate / preserve contract | 6 / 0 / 1 |
| `src/pages/api/tasks/deleteTask.ts` | 2 | Migrate / preserve contract | 1 / 0 / 4 |
| `src/pages/api/tasks/detailMeta.ts` | 5 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/tasks/downloadAttachment.ts` | 4 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/getAll.ts` | 5 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/tasks/getArchivedTasks.ts` | 5 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/tasks/getArchivedTasksByProject.ts` | 5 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/getTask.ts` | 5 | Migrate / preserve contract | 6 / 0 / 0 |
| `src/pages/api/tasks/getTaskMinimal.ts` | 5 | Migrate / preserve contract | 3 / 0 / 1 |
| `src/pages/api/tasks/getUnscheduled.ts` | 5 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/linkPullRequest.ts` | 3 | Zero-caller candidate; retain pending review | 0 / 0 / 0 |
| `src/pages/api/tasks/markRead.ts` | 5 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/tasks/move-task-to-different-board.ts` | 5 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/tasks/moveTask.ts` | 1 | Migrate / preserve contract | 7 / 0 / 1 |
| `src/pages/api/tasks/n8nUpload.ts` | 4 | Migrate / preserve contract | 4 / 0 / 0 |
| `src/pages/api/tasks/reactToDescription.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/recoverTask.ts` | 2 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/removeParent.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/removeRelation.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/searchAll.ts` | 5 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/tasks/searchByParam.ts` | 5 | Migrate / preserve contract | 2 / 0 / 0 |
| `src/pages/api/tasks/searchOrphans.ts` | 5 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/setDueDate.ts` | 3 | Migrate / preserve contract | 3 / 0 / 0 |
| `src/pages/api/tasks/setRecurrence.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/setStartDate.ts` | 3 | Migrate / preserve contract | 1 / 0 / 0 |
| `src/pages/api/tasks/single.ts` | 1 | Migrate / preserve contract | 36 / 0 / 0 |
| `src/pages/api/tasks/uploadFinalize.ts` | 4 | Migrate / preserve contract | 4 / 0 / 2 |
| `src/pages/api/tasks/uploadUrl.ts` | 4 | Migrate / preserve contract | 2 / 0 / 1 |
| `src/pages/api/tasks/waiting-on.ts` | 3 | Migrate / preserve contract | 2 / 0 / 0 |

### Slice 1 local verification

- `node --test tests/htpr-6923-task-writes.test.cjs`: 47 passed, 0 failed. Executes original handlers, real flag dispatcher (On, Off, lookup outage) and shared Web handlers with isolated dependencies; compares status/JSON, query/mutation arguments, actor attribution, permission denial, validation/auth precedence, activity/notification callbacks and realtime effects. Independent SHA-256 pins prevent old/new implementations drifting together. Off does not load operations; failure after dispatch cannot retry a write.
- `node tests/htpr-6923-verify.cjs regression`: invokes `npm run test:file --` for the 11 suites listed in that script; 169 passed, 0 failed (including the 47 above). Covers the shared controller/access gates, Pages runtime imports, MCP service/permission contracts, task route consolidation and UI enforcement.
- `node tests/htpr-6923-verify.cjs flag`: invokes `npm run test:file -- tests/feature-flag-gate.test.cjs tests/feature-flags.test.cjs`; 65 gate tests and 27 registry/mode tests passed. Additional ticket-specific assertions execute the actual registry with a synthetic database: Owner and QA enabled, ordinary caller disabled, no stored flag row.
- `npm run lint`: passed with 0 errors and 21 existing warnings. Full `npx tsc --noEmit --pretty false`: exit 2, the same 15 pre-existing diagnostics as the independently captured baseline, 0 new; `node tests/htpr-6923-verify.cjs quality` rejects any changed diagnostic. This is baseline parity, **not a clean project-wide typecheck**.
- `node tests/htpr-6923-verify.cjs plan` checks complete inventory/caller counts and positive controls. `git diff --check` passes. Local automatic proof is retained in `GATES.md`; it is intentionally not part of the code commit because recording that commit's evidence changes the ledger.
- Verification used Node v22.22.2 and the existing installed dependencies linked from `/home/valentin/projects/hypertask/node_modules`; CI's Node 24/lockfile install is not claimed. No build, live/production data access, push, PR, deployment, board write or dead-endpoint deletion. The build command includes production migrations and is deliberately not run.
- Remaining risk: PUT Off pays an extra signed-session/flag preflight before its unchanged original auth; no latency benchmark is claimed. Router ownership transfer, create/archive and MCP adapter are planned, not implemented in this slice.

### Slice 2 local implementation (not shipped)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `8beb0a21a3e4216fae0c0bf8c2305b5c52a0dc2b` (production at session start). Scope is POST `/api/tasks/create`, `/api/tasks/createGlobally`, and `/api/tasks/(un)archive`; all other methods and URL ownership stay with their original Pages handlers. `recoverTask` and `deleteTask` are explicitly deferred to **slice 2b**, not implemented or removed here.

- Reuses `withTaskWriteFlag`, `taskWriteRoute` and `HTPR_6923_APP_ROUTER_WRITES_FLAG` (`htpr-6923-app-router-writes`, Owner + QA). Off, missing authentication, and flag-lookup failure call legacy; no retry after new-handler loading/execution. No flag registry/default changes.
- Fullscreen and global side-effect helpers moved to shared modules without changing their implementation (the relative queue import becomes its equivalent alias, and four fullscreen blank lines lose trailing whitespace). The verifier reconstructs each complete original file and checks independent SHA-256 pins, including those helpers; legacy handler bodies remain unchanged. Pages keeps the existing fullscreen-helper export. Global creation retains its transaction lock, board/agent checks, compose/existing-empty-task flags, assignee/label validation, outboxes, due-date scheduling and post-response `waitUntil` fanout. No shared mutation-controller redesign.
- **Intentional legacy no-response:** ordinary `create` still resolves without writing a status/JSON when no section is found, or when an existing task yields no generated rank. The flag adapter accepts `undefined` and does not manufacture a response or fall back. Fixing this requires a separate compatibility decision. Fullscreen still returns its nested `newTask` envelope and exceptional 406.
- Legacy validation/auth precedence and failure boundaries remain intact: global null-body/pre-auth or post-commit failures still reject rather than gaining a catch/retry; archive still returns its 500 with `error: String(error)`, including the original `req.body` wording. Pages passes parsed cookies/body directly; Web requests read the cookie header. Custom response headers, notably global `Server-Timing`, pass through the adapter.
- Archive/unarchive preserves `updateTaskSingle`, signed agent ownership, due-date cancellation only for Archive, inbox refresh, activity, notification and board/task realtime ordering. Refused writes stop before those effects; queue/activity failures after persistence retain the old 500 policy.
- Focused verification: `node --test tests/htpr-6968-task-lifecycle.test.cjs`, the slice-1 contracts, creation/archive regression suites and `node tests/htpr-6923-verify.cjs lifecycle`; targeted ESLint only. The one full `npx tsc --noEmit --pretty false` found two missing `IAgent` imports versus the captured production baseline's zero diagnostics. Both imports were restored; a focused binding/production-narrowing test verifies the correction and rejects a missing-import control. Source fingerprints prove the only post-typecheck production edits are those imports and the four whitespace-only blank-line cleanups. No second full typecheck was run, so a clean post-fix full typecheck is **not claimed**. Logs and gates live outside the repository at `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice2/`.
- Size accounting separates byte-pinned relocated helper lines from new/changed production lines; no recover/delete migration is included. No full lint/suite, build, live mutation, board write, push, PR or deployment is performed. Production verification belongs to the owning shipping session.
