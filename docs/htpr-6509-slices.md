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
| 1 (shipped, PR 1104) | PUT task update and in-board move: `single.ts`, `moveTask.ts`; shared Web handlers, Zod-compatible wrapper, server flag and old/new contract tests. No URL/caller changes. |
| 2 (shipped, PR 1122) | https://app.hypertask.ai/detail/project-15/6968 covers `create`, `createGlobally`, `(un)archive`: shared Web handlers, unchanged legacy fallback, fullscreen/global variants and queue/inbox effects. Creation's unresolved-section/no-response branch stays unchanged. **Slice 2b:** `recoverTask`, `deleteTask` shipped with slice 3 in PR 1127. |
| 3 (shipped, PR 1127) | All task schedule, parent/relation, waiting-on, description reaction and PR linking writes are flag-gated shared handlers. Task-update pipeline and public JSON preserved; zero-caller PR endpoint retained pending external-use review. No slice-3 remainder; physical URL ownership transfer remains deferred as designed. |
| 4 (shipped, PR 1132) | Task attachments: POST `uploadUrl`, POST `uploadFinalize` and GET `downloadAttachment` use flag-gated shared handlers. Multipart/raw-body POST `n8nUpload` remains byte-pinned legacy: the JSON adapter cannot carry its stream or `bodyParser: false` configuration. Same URLs, limits, response formats and external storage contracts; verification and live QA handoff below. |
| 5 (shipped, PR 1135) | GET/DELETE `single`, POST `markRead` and POST cross-board move use shared flag-gated handlers, preserving complete parent/subtask fields. **Slice 5b (shipped, PR 1140):** nine remaining readers use shared flag-gated handlers; `getAll` remains byte-pinned legacy to keep PR 1119's independent compatibility flag untouched, reserved for slice 5c. Historical remainder and current status below. |
| 6 (shipped, PR 1142) | All seven project core POST writes and seven remaining read endpoints use flag-gated shared handlers, including signed-cookie-only reads and member removal. No slice 6b remainder. `projects/detail` stays **reserved for the sibling compatibility ticket**; views stay slices 7–8. Verification and live QA handoff below. |
| 7 (local; not shipped) | All project view create/update/delete/rename/switch/unsaved/reset writes have shared flag-gated handlers; current shared UI, callers and URLs remain unchanged. Verification and live QA handoff below. |
| 8 (local; not shipped) | All view order/default-order/smart-split writes have shared flag-gated handlers. Historical 101/401/404/409 statuses retained; zero-caller `sync-view` stays byte-pinned legacy for slice 12's external-use review. |
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
| `/api/tasks/getAll` | 0 / 0 / 0 | Slice 5b: retain the route and shared controller, including PR 1119's compatibility flag. Zero tracked callers alone do not authorize removal; external-use review is still required. |
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

### Slice 2 verification record (shipped in PR 1122)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `8beb0a21a3e4216fae0c0bf8c2305b5c52a0dc2b` (production at session start). Scope is POST `/api/tasks/create`, `/api/tasks/createGlobally`, and `/api/tasks/(un)archive`; all other methods and URL ownership stay with their original Pages handlers. `recoverTask` and `deleteTask` are explicitly deferred to **slice 2b**, not implemented or removed here.

- Reuses `withTaskWriteFlag`, `taskWriteRoute` and `HTPR_6923_APP_ROUTER_WRITES_FLAG` (`htpr-6923-app-router-writes`, Owner + QA). Off, missing authentication, and flag-lookup failure call legacy; no retry after new-handler loading/execution. No flag registry/default changes.
- Fullscreen and global side-effect helpers moved to shared modules without changing their implementation (the relative queue import becomes its equivalent alias, and four fullscreen blank lines lose trailing whitespace). The verifier reconstructs each complete original file and checks independent SHA-256 pins, including those helpers; legacy handler bodies remain unchanged. Pages keeps the existing fullscreen-helper export. Global creation retains its transaction lock, board/agent checks, compose/existing-empty-task flags, assignee/label validation, outboxes, due-date scheduling and post-response `waitUntil` fanout. No shared mutation-controller redesign.
- **Intentional legacy no-response:** ordinary `create` still resolves without writing a status/JSON when no section is found, or when an existing task yields no generated rank. The flag adapter accepts `undefined` and does not manufacture a response or fall back. Fixing this requires a separate compatibility decision. Fullscreen still returns its nested `newTask` envelope and exceptional 406.
- Legacy validation/auth precedence and failure boundaries remain intact: global null-body/pre-auth or post-commit failures still reject rather than gaining a catch/retry; archive still returns its 500 with `error: String(error)`, including the original `req.body` wording. Pages passes parsed cookies/body directly; Web requests read the cookie header. Custom response headers, notably global `Server-Timing`, pass through the adapter.
- Archive/unarchive preserves `updateTaskSingle`, signed agent ownership, due-date cancellation only for Archive, inbox refresh, activity, notification and board/task realtime ordering. Refused writes stop before those effects; queue/activity failures after persistence retain the old 500 policy.
- Focused verification: `node --test tests/htpr-6968-task-lifecycle.test.cjs`, the slice-1 contracts, creation/archive regression suites and `node tests/htpr-6923-verify.cjs lifecycle`; targeted ESLint only. The one full `npx tsc --noEmit --pretty false` found two missing `IAgent` imports versus the captured production baseline's zero diagnostics. Both imports were restored; a focused binding/production-narrowing test verifies the correction and rejects a missing-import control. Source fingerprints prove the only post-typecheck production edits are those imports and the four whitespace-only blank-line cleanups. No second full typecheck was run, so a clean post-fix full typecheck is **not claimed**. Logs and gates live outside the repository at `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice2/`.
- Size accounting separates byte-pinned relocated helper lines from new/changed production lines; no recover/delete migration is included. No full lint/suite, build, live mutation, board write, push, PR or deployment is performed. Production verification belongs to the owning shipping session.

### Slice 2b + 3 local implementation

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `0936973863bf587ce26e9bee0a4def6d9354a52b` on branch `htpr-6968-slice-3`. Slices 1 and 2 shipped in PR 1104 and PR 1122; this local-only change covers **all of 2b and 3**, with no remainder. Pages still owns every URL and method. Shared Web handlers live in `src/lib/api/task-writes/{recover,delete,due-date,start-date,recurrence,add-parent,remove-parent,add-relations,remove-relation,waiting-on,description-reaction,link-pull-request}.ts`.

- Same `withTaskWriteFlag`, `taskWriteRoute` and `HTPR_6923_APP_ROUTER_WRITES_FLAG` (`htpr-6923-app-router-writes`, Owner + QA). Off, missing session and lookup outage use unchanged legacy; other methods bypass preflight. No retry after loading/executing On. No registry/default changes, MCP/service-pipeline edits, typed-client changes or App/Pages URL twins.
- Original complete Pages implementations, including the PR factory and reaction notification helper, have independent SHA-256 pins in `tests/htpr-6923-verify.cjs slice3`. Tests execute the reconstructed originals alongside Off/outage/On and direct Web handlers, with isolated synthetic dependencies. Null-body errors, auth/validation order, supplied query arrays and the original public JSON are preserved. `taskWriteRoute` permits endpoint-owned null-body handling; the adapter now also carries query input and an explicit empty response without conflating it with creation's no-response branch.
- Recover retains deterministic descendant mutation fences, owned-agent checks, both 409 conflicts and best-effort delete-job cancellation after a committed restore. Delete still requires status Deleted and writable board access, validates query IDs before auth, keeps its 409 outcome and only broadcasts after success. Schedule/parent routes retain `updateTaskSingle`, due-date notification/change detection, queue cancellation/scheduling, start-date/recurrence access checks and original realtime fan-out.
- Parent missing-data/errors still return 200 string/array; add/remove relation errors still return an **empty 200**, and removeRelation retains its nested response envelope. Cross-board broadcasts are deduplicated. Waiting-on keeps membership checks, activity and old/new inbox refresh. Reaction creation/toggling retains creator-notification/FCM behavior and body-user confirmation. PR linking remains signed-legacy-cookie-only (Better Auth alone does not authorize it), including 201/200, typed errors/lease conflicts and best-effort realtime.
- PR URL retained: re-audit finds zero tracked HTTP callers in app/native CLI/e2e, excluding only relocated PR diagnostic log strings and exercising an injected caller control. No runtime/external-use evidence authorizes removal. Shared PR-link service/MCP operation and exported Pages test factory remain intact.
- Verification: `node --test tests/htpr-6968-task-relations.test.cjs` **191 passed, 0 failed**; seven focused migration/controller regression files from the evidence ledger **194 passed, 0 failed**. `node tests/htpr-6923-verify.cjs slice3`, targeted `npx eslint <changed TS/CJS files>` and `git diff --check` pass. Conservative size is **543 non-relocated production lines**: 917 added + 16 removed − 390 matching legacy lines (only same-file lines with at least eight non-whitespace characters are discounted; tests/docs excluded). Evidence ledger: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice3/GATES.md` (outside the repo).
- One full `npx tsc --noEmit --pretty false` exited **0 with zero diagnostics**, matching the independently captured clean production baseline at `8beb0a21a3e4216fae0c0bf8c2305b5c52a0dc2b` retained from slice 2 (an ancestor, not a newly compiled slice-3 baseline). After compilation, only a trailing EOF blank line in the shared reaction module was removed to satisfy `git diff --check`; compiler-bound source snapshots prove every other byte unchanged and trailing-whitespace-normalized equality for that file. No second full compiler run. Node v22.22.2 and existing linked dependencies used; no fresh CI install/Node-24 run claimed.
- Live QA/build/deploy are **not performed** here; no push, PR, board write or stash. Risks remain the extra Off preflight and unbenchmarked live queue/realtime/integration behavior. Physical same-URL App ownership transfer is still deferred by the migration design.

#### Live QA handoff (not executed)

Use Owner/QA with the existing migration flag On, then compare Off on the same authorized disposable board/tasks. Verify refresh/activity/inbox behavior as appropriate. Permanent deletion must use a disposable task explicitly approved for destruction, never a real work item. Task paths below refer to `/detail/project-<board>/<number>`; Trash is `/trash/<board>`.

| Endpoint | UI path / action to exercise the write |
| --- | --- |
| POST `/api/tasks/recoverTask` | Trash → select a deleted task → **Recover this task**; verify its descendants return too. |
| DELETE `/api/tasks/deleteTask` | Trash → select a different disposable deleted task → trash icon → confirm permanent deletion; ordinary task Delete calls the soft-delete queue, not this endpoint. |
| POST `/api/tasks/setDueDate` | Task → Ctrl+K → **Set due date** (or D) → choose date, change date, then clear it. |
| POST `/api/tasks/setStartDate` | Task → Ctrl+K → **Set start date** → choose date, then clear it. |
| POST `/api/tasks/setRecurrence` | Task → Ctrl+K → **Repeat task** → choose cadence, then clear it. |
| POST `/api/tasks/addParent` | Parent task → description's subtask add/link control → choose an existing orphan task (not create a new subtask). |
| POST `/api/tasks/removeParent` | Child task → Ctrl+K → **Remove as sub-task**, or parent → **Remove a sub-task**. |
| POST `/api/tasks/addRelations` | Task → Ctrl+K → **Add related task**, **Mark blocked by**, **Mark as blocking** or **Mark duplicate of** → choose another task; include a cross-board task. |
| POST `/api/tasks/removeRelation` | Task → relation row → remove link; verify both affected boards refresh. |
| POST `/api/tasks/waiting-on` | Task → Ctrl+K → **Blocked by person…** (Shift+B) → select member; then clear via the task's blocked-by row. |
| POST `/api/tasks/reactToDescription` | Task description → add emoji reaction; click it again to remove; use another author's description to exercise notifications. |
| POST `/api/tasks/linkPullRequest` | **No UI caller**. A browser click cannot exercise this endpoint; an authorized same-origin API request with signed `ht_session`, disposable task ID and GitHub PR URL is required. Verify created 201, existing 200 and Better-Auth-only 401; MCP linking uses a separate surface. |

### Slice 4: task attachment handshakes and signed download (local; not shipped)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `f888b94e5fe8fcba2735259bab717182b0be7130`, branch `htpr-6968-slice-4`. Slices 1–3 shipped in PRs 1104, 1122 and 1127. Pages retains ownership of every URL; no App/Pages twins or frontend, typed-client, MCP, tooltip, flag-registry or flag-mode changes.

- POST `/api/tasks/uploadUrl`, POST `/api/tasks/uploadFinalize` and GET `/api/tasks/downloadAttachment` dispatch through the existing `withTaskWriteFlag` to `src/lib/api/task-writes/{upload-url,upload-finalize,download-attachment}.ts`, using `taskWriteRoute` and the same `htpr-6923-app-router-writes` flag (Owner + QA). Off, missing session and lookup failure use the byte-pinned legacy implementations. Other methods bypass preflight; loading/operation failures never retry legacy.
- Uploads retain signed-cookie-first / Better Auth fallback and `{ error: "Unauthorized", code: "SESSION_REQUIRED" }`. Grants/receipts remain user- and key-scoped; background task linking keeps its separate existing upload flag, service permissions and best-effort realtime. Direct upload keeps **500 MiB per file, 1 GiB per batch, 10 files**, 255-byte names, doubled HEIC object allowance and preview exclusion from attachment receipts. Signed PUTs retain exact `ContentLength`/MIME binding, 900-second expiry, server-chosen keys and public file URL shape. Finalize measures stored lengths, deletes oversized/discarded objects, and keeps existing 400/403/409/413/500 bodies and cleanup ordering.
- Download returns the same signed-URL JSON (it does **not** stream file bytes), 60-second storage expiry and encoded attachment filename. Project/member/owner and chat-owner checks, legacy unrecorded-file allowance and `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0` remain unchanged. The shared adapter now sends nonempty non-JSON responses with Pages `send`, preserving download's 400/403/500 text errors instead of parsing or JSON-quoting them; existing empty relation responses remain untouched.
- **Explicit legacy remainder:** POST `/api/tasks/n8nUpload` consumes a raw multipart request stream through `raw-body`; `export const config` with `bodyParser: false` cannot be transported by the parsed-JSON adapter. The complete file is byte-pinned and unchanged, including binary parsing, auth-before-body-read, 4 MiB file / 4.5 MiB request caps, multipart overhead, MCP count/batch limits and external URL/receipt contracts. No unsupported JSON adaptation or new streaming claim is made. A later migration needs a dedicated raw-body adapter and its own tests.
- Up-front test audit found three existing files directly compiling/importing the wrapped Pages routes: `upload-session-sources`, `upload-size-limit`, `heic-dual-upload`. Their pass-through `withTaskWriteFlag` stubs keep testing legacy. `node --test tests/htpr-6968-attachments.test.cjs`: **92 passed, 0 failed**, comparing reconstructed originals, Off/outage/On and direct Web handlers for success, validation, auth, denial, limits, query arrays, headers, S3 signatures and side-effect ordering; loader failures prove no legacy retry. Seven sequential scoped regression files: **375 passed, 0 failed**. Attachment/lifecycle/slice-3 byte-pin checks, changed-file ESLint and `git diff --check` pass. No new HTML sanitizer patterns.
- One final `npx tsc --noEmit --pretty false`: exit **2**, **15 existing diagnostics, 0 new** versus the independently captured production baseline `0c5006f8f743808047bfdac06da4313a47706e29` with the shared dependency install. This is an inherited ancestor baseline, not a fresh production compile or clean typecheck. Three MCP diagnostics moved down one line: the evidence checker proves the entire file differs only by the pre-existing annotation line before mapping those locations; this slice does not edit MCP. No compiler rerun was needed. The stale dependency symlink was repaired to `/home/valentin/projects/hypertask/node_modules`; evidence includes compiler-bound source hashes.
- Evidence: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice4/GATES.md`. No full lint/suite, build, live mutation, board write, stash, push, PR or deploy. Remaining risks: extra Off auth/flag preflight, unbenchmarked live S3/CORS/realtime behavior, and intentionally unmigrated multipart upload. Live QA is a shipping-session handoff, not claimed here.

#### Live QA: slice 4 handoff (not executed)

Use Owner/QA with the migration flag On, then compare Off on disposable tasks on an authorized board. Keep the separate optimistic-upload flag at its live mode. Open a real task at `/detail/project-<board>/<number>`; confirm endpoint requests in the browser network panel, not just a visually successful upload.

| Endpoint | UI path / action |
| --- | --- |
| POST `/api/tasks/uploadUrl` | Task → bottom comment editor → attach/paste/drop a small file; confirm signed ticket JSON and storage PUT. Also attach a HEIC to exercise paired preview keys, and a larger-than-4-MiB file to confirm direct upload rather than the buffered cap. |
| POST `/api/tasks/uploadFinalize` | Same comment attachment flow → wait for upload to finish → post comment; confirm finalize verifies stored bytes. With the existing optimistic task-upload flag enabled, New Task → attach file → create task exercises receipt issuance/linking; attach then cancel/discard a disposable draft exercises cleanup. |
| GET `/api/tasks/downloadAttachment` | Task → click an uploaded image attachment → attachment carousel → **Download**; confirm signed URL JSON, no-cache headers and correct filename. Another unauthorized account must not receive a URL for the recorded attachment. |
| POST `/api/tasks/n8nUpload` (legacy) | In the browser network panel, temporarily block `/api/tasks/uploadUrl` (or simulate storage network failure), then Task → bottom comment editor → attach a file below 4 MiB. Confirm buffered multipart fallback succeeds, then remove the temporary block. This requires deliberate network fault injection: a normal successful attachment click only exercises direct upload. |

### Slice 5: single read/delete, mark-read and cross-board move (shipped, PR 1135; original local evidence)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `3538ae4643165606a2fcd67d90e42c64a48f6abf`, branch `htpr-6968-slice-5`. Slices 1–4 shipped in PRs 1104, 1122, 1127 and 1132. Pages still owns every URL; shared handlers live in `src/lib/api/task-writes/{single-read-delete,mark-read,move-to-different-board}.ts`. No physical App/Pages ownership transfer, UI/client, MCP, tooltip, flags/defaults, or shared-controller changes.

- GET/DELETE `/api/tasks/single`, POST `/api/tasks/markRead` and POST `/api/tasks/move-task-to-different-board` use the existing `withTaskWriteFlag` (including its GET method dispatch), `taskWriteRoute`, and `htpr-6923-app-router-writes` flag (Owner + QA). Off, missing session and flag-lookup failure use byte-pinned legacy. PUT single remains slice 1's handler. Unsupported methods bypass preflight. Loading/execution failures never retry legacy after dispatch.
- Single GET retains auth-before-query-validation, the original `parseInt` behavior including arrays/prefixes, 200/null for absent tasks, its board-access check only on a successful task with a project, and its exceptional `500` message with serialized error appended. Full task, description, labels, priority, estimate, parentTask, subTasks and the parent's subTasks remain unprojected and unchanged. DELETE retains query-validation-before-auth, board authorization, the existing `deleteTaskSingle` permanent-delete choke point, 409 conflict and error bodies, with no new broadcasts.
- markRead retains object and string/beacon bodies, permissive `parseInt(String(taskId), 10)`, auth-before-validation, signed-session-only actor selection, 400 invalid IDs, 500 null-body failures and controller status/JSON. **No board-permission check is added:** legacy only scopes the read-state row to the signed user; altering that policy is outside a contract-preserving refactor. Existing race recovery and missing-task handling remain in the untouched controller.
- Cross-board move still loads the complete signed actor before validating the body, forwards the same four fields to `moveTaskToDifferentBoard`, and returns the complete task or original status/error envelope. Nested-subtask relocation, source/destination authorization, allocation/retry, team-switch cleanup, due-date queues, labels, notifications and saved content remain in that unchanged shared service. Source/destination broadcasts remain deduplicated, ordered after success, and non-awaited; a synchronous broadcast failure still returns 500 after persistence. Actor-load/auth exceptions still propagate where legacy did.
- Up-front grep of all `tests/*.cjs` found three direct compile/import harnesses: `task-single-auth`, `task-mark-read`, `htpr-6923-task-writes`. Single's existing pass-through stub is retained; markRead receives one; slice 1's unsupported-method test now excludes GET/DELETE because they are migrated. Each is run separately. `tests/htpr-6968-slice5.test.cjs` compares reconstructed originals with Off/outage/On and direct Web handlers: success, validation, auth, denial where legacy has authorization, query arrays, actor spoofing, failure boundaries, complete relations and side-effect order. Real Pages `apiResolver` comparisons also assert exact response bytes, Content-Type, Content-Length and ETag, including beacon requests. No HTML sanitizer is introduced, including in test fixtures.
- Verification evidence and measured results: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice5/GATES.md`. Only changed-file ESLint, touched-code/compatibility regressions and one final TypeScript check are authorized. TypeScript is compared to the independently captured production baseline `0c5006f8f743808047bfdac06da4313a47706e29` using the same shared dependency install; that is an inherited ancestor baseline, not a fresh production compile. The three MCP line shifts are aligned only after proving the entire file changed solely by the pre-existing annotation insertion. Results: **92 new contract tests + 526 focused regressions, 0 failures**; lifecycle/slice-3/attachment/slice-5 byte pins and changed-file ESLint pass. One final `npx tsc --noEmit --pretty false` exits **2**, with **15 existing baseline diagnostics and 0 new**, no repair rerun. The diff has **190 raw changed production lines**, below 800 without a relocation discount; `git diff --check` passes.

#### Historical slice 5b remainder (superseded by the slice 5b record below)

At slice 5's base, the ten remaining read shells cover **648 existing route lines** with heterogeneous auth/query/error/cache contracts, in addition to this slice's four core operations. They are split out to keep the review PR-sized rather than layering all read adapters and compatibility cases into this commit; this is **partial slice 5**, not a completed read migration. All ten files are verified byte-for-byte unchanged against the base:

| Legacy endpoint | Slice 5b reason / preserved behavior |
| --- | --- |
| POST `/api/tasks/getAll` | PR 1119 already merged `htpr-6924-rest-compat`: compact only for the exact scalar `compat=htpr-6924` query and an enabled flag for the resolved signed identity; Off/outage/absent query/arrays preserve full relations. Leave both route and controller untouched and pinned; run existing on/off shape, query and real-resolver identity contracts. External-use review has not authorized removal. |
| GET `/api/tasks/getArchivedTasks` | Scope/cursor/query parsing and meta/full variants need their own contract matrix. |
| GET `/api/tasks/getArchivedTasksByProject` | Keep its distinct 400 validation/error envelope. |
| GET `/api/tasks/getTask` | Preserve private/no-store and Vary: Cookie, full actor and slug/alias resolution in its own read slice. |
| all methods `/api/tasks/getTaskMinimal` | Legacy has no method/auth gate; a shared authenticated wrapper must not silently change this exceptional contract. |
| GET `/api/tasks/getUnscheduled` | Direct Prisma relation/search/order query and membership lookup need isolated pins and tests. |
| GET `/api/tasks/detailMeta` | Scoped task lookup, follower filtering, 404 denial and private cache headers need independent contracts. |
| POST `/api/tasks/searchAll` | Recent-task mode and accessible-board filtering need their own matrix. |
| GET `/api/tasks/searchByParam` | Preserve its separate status-config error bodies and permissive query parsing. |
| GET `/api/tasks/searchOrphans` | Legacy has no auth gate and exceptional 200 string/array errors; do not impose new auth during extraction. |

#### Live QA: slice 5 handoff (not executed)

Use Owner/QA with `htpr-6923-app-router-writes` On, then Off, on explicitly approved disposable tasks/boards. Watch the exact endpoint in the browser network panel; ordinary task opening can use SSR/cached data rather than GET single. No live mutations, board writes, pushes, PRs, builds or deployments are performed in this local-only session.

| Endpoint | UI path / action |
| --- | --- |
| GET `/api/tasks/single?id=<id>` | Task at `/detail/project-<board>/<number>` → Ctrl+K → **Duplicate task** → inspect the populated New Task draft, then cancel; confirm single GET and full parent/subtask fields in the network response. Board → select task → due-date/start-date controls also use this reader when the query cache is cold. |
| POST `/api/tasks/markRead` | Task → read comments → leave via Back/next task; confirm markRead and updated read timestamp. Leave/reload the browser tab separately to exercise pagehide's sendBeacon body. |
| POST `/api/tasks/move-task-to-different-board` | Disposable parent with subtasks → Ctrl+K → **Move task to board** (Shift+M) → choose destination board/column → submit; verify relocated parent/subtasks, ticket identity, destination route and both board refreshes. Compare refusal with an account lacking destination access. |
| DELETE `/api/tasks/single?id=<id>` | **No UI caller found.** Trash's permanent-delete button calls `/api/tasks/deleteTask`, not single DELETE. Use an explicitly destruction-approved disposable deleted task and an authorized same-origin API request; verify 200, denied board 403 and concurrent restore/delete 409. Do not claim a Trash click covers this retained API. |
| POST `/api/tasks/getAll` (legacy) | **No UI caller found.** Same-origin read request on an authorized disposable board, with `compat=htpr-6924`: compare `htpr-6924-rest-compat` On/Off/outage and absent/array query full shapes. This slice never changes that flag or endpoint. |

Remaining risks: extra Off auth/flag preflight, unbenchmarked live realtime/queue timing, destructive DELETE requiring explicit QA approval, the preserved markRead authorization policy, and the explicitly unmigrated slice 5b reads. Live QA remains the owning shipping session's responsibility.

### Slice 5b: shared task list and search reads (shipped, PR 1140; original local evidence)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `3b539b2a27b8c45c136b0504e7c469fc29fd7c2d`, branch `htpr-6968-slice-5b`. Slices 1–5 shipped in PRs 1104, 1122, 1127, 1132 and 1135. Nine readers now dispatch through `withTaskWriteFlag` to shared Web handlers in `src/lib/api/task-writes/`; Pages still owns all URLs. Same `htpr-6923-app-router-writes` flag (Owner + QA), no registry/default changes, no sibling typed-client, MCP, tooltip or controller edits.

- GET `getArchivedTasks`, `getArchivedTasksByProject`, `getTask`, `getUnscheduled`, `detailMeta`, `searchByParam`, `searchOrphans`; POST `searchAll`; every legacy method of `getTaskMinimal`. Off, missing session and flag lookup failure execute unchanged, independently byte-pinned legacy bodies. Other methods bypass preflight except minimal, whose legacy accepts every method. No retry after loading/executing On. Query adaptation preserves repeated URL parameters as arrays and passes existing Pages query objects unchanged.
- Authenticated reads use `taskWriteRoute` with permissive schemas; validation and exceptional errors stay endpoint-owned. Archive retains first-array-value parsing, permissive integers, scope defaults, trimmed query and **scalar-only** `mode=meta`. Project archives retain their 400 missing-field/exception policy. Task read retains full actor preparation before validation/outside catch, slug/alias inputs, complete parent/subtask JSON and private/no-store + Vary: Cookie, including auth/actor failures. Unscheduled retains membership lookup, saved content, limit 10 and createdAt-for-search / updatedAt-without-search ordering. Metadata retains membership-only scope (including archived boards), 404 denial, creator/agent follower filtering and private headers.
- **No new auth policy:** `getTaskMinimal` and `searchOrphans` intentionally bypass the authenticated `taskWriteRoute` operation while still using the same signed-session flag dispatcher. Missing sessions stay on legacy; direct shared readers retain the old unauthenticated contract. Minimal retains the full scalar row, arbitrary method/body ID types and 500 null-body error. Orphan search retains its nested `{ status, json }` response, permissive parseInt, full subtasks and exceptional 200 string/array errors. This extraction does not endorse or repair those existing access policies.
- Searches never reorder or project results. `searchAll` retains accessible-board filtering and recent-task mode; real-controller ranking fixtures prove exact references first, descending recency, stable ties and deduplication. All three search adapters preserve fixture JSON bytes/order and full nested fields; orphan fixtures also assert the actual controller's createdAt-desc query. The original search controllers remain byte-identical to the base, including mention ranking and independent flags.
- **Legacy remainder / slice 5c:** POST `/api/tasks/getAll` and its controller are untouched and pinned. PR 1119's independent `htpr-6924-rest-compat` migration has real-resolver identity and compact/full-shape contracts; keeping it legacy avoids copying that flag/identity policy into a second handler in this slice. Exact scalar `compat=htpr-6924` + enabled flag selects compact; Off/outage/absent query/arrays keep full parent/subtask fields. Existing contracts for both shapes pass. No tracked UI caller or external-use evidence authorizes removing its URL. No searches remain for 5c.
- Up-front audit of all `tests/*.cjs` finds one existing runtime harness compiling a wrapped reader: `task-relation-picker-recents`; its pass-through `withTaskWriteFlag` stub keeps exercising legacy and all seven tests pass. `task-detail-gettask-cache` only inspects source and also passes. No HTML sanitizers or CodeQL-triggering sanitizer patterns are introduced, including tests.
- Focused verification: **158 new contracts + 63 focused regressions, 0 failures** across eight separately run files. Original/Off/outage/On/direct-Web cases cover success, validation, authentication, delegated/direct permission denial, arrays/numeric prefixes, cache headers and failure boundaries. Real Pages resolver cases compare exact JSON bytes, Content-Type, Content-Length and ETag; private-header exception tests cover auth/actor rejection. Lifecycle, slice-3, attachment, slice-5 and slice-5b byte pins pass. Changed-file ESLint and `git diff --check` pass. **573 raw changed production lines**, below 800 without any relocation discount.
- TypeScript baseline: the final check is compared with the independently captured production ancestor `0c5006f8f743808047bfdac06da4313a47706e29`, using the same shared dependency install; this is not a fresh production compile. Only the proven pre-existing one-line MCP annotation insertion is used to align three diagnostic locations. One final `npx tsc --noEmit --pretty false` exited **2** with **15 existing baseline diagnostics, 0 new**, with no repair rerun. Compiler-input fingerprints bind the evidence to the final TypeScript sources.
- Evidence: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice5b/GATES.md`. Local commit only: no full lint/suite, board writes, stash, push, PR, build, deployment or live QA. Risks: extra Off auth/flag preflight (including previously public readers), unbenchmarked live timing, deliberately preserved public-reader access policies and the one unmigrated compatibility reader.

#### Live QA: slice 5b handoff (not executed)

Use Owner/QA with `htpr-6923-app-router-writes` On then Off on the same authorized board; confirm each exact network request, not just the rendered UI. Do not change the independent compatibility or mention flags. Read-only denied-account requests must preserve the original status/body. Cache/SSR can skip readers, so start cold or disable browser cache. Cancel all drafts/pickers; no task mutation is needed to exercise these reads.

| Endpoint | UI path / action |
| --- | --- |
| GET `/api/tasks/getArchivedTasks` | `/archived` → tasks → change active/archived/all board scope, choose board, search and scroll for the next page; inspect both full-list and `mode=meta` requests. |
| GET `/api/tasks/getArchivedTasksByProject` | Board → Ctrl+K → **Show archived tasks**; inspect the board's archived-card request, then restore the view setting. |
| GET `/api/tasks/getTask` | Task `/detail/project-<board>/<number>` → bottom comment editor → paste another task's detail URL to resolve its title; cancel the draft. A task realtime refetch also uses this endpoint; ordinary opening may use SSR/cache instead. |
| all methods `/api/tasks/getTaskMinimal` | Board → select task → Ctrl+K → **Copy task URL** / formatted task link; verify the POST reader and copied link. Other legacy methods need same-origin read-only API requests; clicking Copy only covers POST. |
| GET `/api/tasks/getUnscheduled` | Calendar → click an empty date to open the task chooser → search unscheduled tasks, clear search, then cancel; inspect both query/order variants. |
| GET `/api/tasks/detailMeta` | Cold-open task `/detail/project-<board>/<number>` → inspect priority, size, labels and followers; verify scoped metadata request/private headers. Repeat with an archived-board task and a denied account (404). |
| POST `/api/tasks/searchAll` | Task → Ctrl+K → **Add related task** → inspect recent suggestions with empty search, then search a ticket reference/text; cancel. Global Search also uses this route. Confirm result order and accessible-board filtering. |
| GET `/api/tasks/searchByParam` | Task → bottom comment editor → type `@`, then a name/task query; inspect mention results/order and denied-board response; cancel the draft. |
| GET `/api/tasks/searchOrphans` | Parent task → **Sub-task** add/link control → choose the existing-task linking picker → search; inspect complete subtasks and the unchanged nested response envelope, then cancel. |
| POST `/api/tasks/getAll` (legacy) | **No UI caller found.** Authorized same-origin read on a board with `compat=htpr-6924`: compare the live compatibility flag's compact/full cases, absent query and repeated `compat` arrays. Its flag/default and URL remain unchanged; an ordinary board click does not cover this endpoint. |

### Slice 6: shared project core writes and remaining reads (local; not shipped)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `e3d95b6309ac2caad7e8a4dfa9e4ea72241f485c`, branch `htpr-6968-slice-6`. Slices 1–5b shipped in PRs 1104, 1122, 1127, 1132, 1135 and 1140. All 14 non-reserved project core route files now use shared Web handlers in `src/lib/api/project-writes/`, reusing `withTaskWriteFlag` and `taskWriteRoute` from `src/lib/api/task-writes/route.ts`. Pages retains URL ownership; no App/Pages twins, client, MCP, controller or flag-registry changes. **395 raw changed production lines**, without a relocation discount; no slice 6b remainder.

- Same server flag `htpr-6923-app-router-writes` (Owner + QA). Off, missing session and flag-lookup failure call byte-pinned legacy. Unsupported methods bypass preflight; loading/execution failures never retry legacy. No new dispatch mechanism or project-specific flag.
- `removeMember`, `getAll`, `getAllMinimal` and `getFirst` remain **signed-cookie-only**, even after Better Auth preflight; the signed actor wins over a stale Better Auth identity. Other endpoints retain `getSessionUser`. Body/query/profile-cookie IDs cannot replace the authenticated actor. `boardTasks` and the signed-cookie endpoints preserve `{ error: "Unauthorized", code: "SESSION_REQUIRED" }`; others retain `{ message: "Unauthorized" }`.
- Authorization stays in untouched shared controllers: rename permits board members/owners; archive, delete and member removal permit owners/accepted human Admins; role changes permit **only the owner**. Leave still removes the signed user's human/agent memberships and keeps its existing missing-member 400, not a newly invented 403. Create retains quota, prefix flag/locking and default-view/log behavior. `getFirst` can still create a fallback board when none exists; its GET is not assumed side-effect-free.
- Preserved contracts include controller statuses/complete JSON, auth/validation order, update's actor load outside its catch, null-body exceptions outside the archive/delete/leave catch, their historical `Failed to add new section` error, remove-member's `200 ["Success"]`, role/error JSON serialization, `getAll` timing logs and optional active-project body, and minimal-reader mode strings/arrays unchanged. No additional query validation, response projection, cache headers or realtime effects.
- Up-front `tests/*.cjs` audit: four compile/import harnesses (`board-rename`, `get-first-project-session`, `project-prefix`, `remove-member-auth`) receive pass-through wrapper stubs. Three project route source-reader suites also run. Dynamic route-loading compatibility suites were inspected: their project endpoint is reserved `detail`, not a wrapped core route. All controllers and sibling files remain unchanged.
- `node --test tests/htpr-6968-project-core.test.cjs`: **293 passed, 0 failed**, comparing independently pinned originals, Off/outage/On and direct Web requests for success, validation, authentication, non-member/member/admin/owner policy, signed-only sources, failure boundaries, query arrays and actual Pages resolver HTTP bytes/headers. Twelve focused legacy/controller suites: **131 passed, 0 failed**. Changed-file `npx eslint`, existing lifecycle/slice3/attachment/slice5/slice5b pins, project-core pins and `git diff --check` pass. No incomplete-regex HTML sanitizer is introduced in code or tests.
- Final TypeScript evidence is compared to the independently captured production baseline `0c5006f8f743808047bfdac06da4313a47706e29` using the same shared dependency install; this is an inherited ancestor baseline, not a fresh production compile. The existing one-line MCP annotation insertion is proved byte-exact before mapping its three diagnostic locations. One final `npx tsc --noEmit --pretty false` exited **2: 15 inherited diagnostics, 0 new**, with no rerun. One `AppSheet` diagnostic prints the same `Omit<CommonProps, ...>` union members in a different order; the comparator proves that file is byte-identical to the captured production source, sorts only that exact diagnostic's union, and rejects a changed-member control. This is baseline parity, not a clean project-wide typecheck.
- Explicit legacy exclusions: `projects/detail` belongs to sibling https://app.hypertask.ai/detail/project-15/6924; all project-view routes belong to slices 7–8. Audit of the other Pages routes finds no additional core Project mutation/controller shell: AI project instructions/attachments, favorites and invites are separate domains, not folded into this slice. No endpoints are removed. Build/live QA/deploy are not performed; no full lint/suite, board write, stash, push or PR. Extra Off auth/flag preflight and live integration timing remain unbenchmarked.
- Evidence ledger: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice6/GATES.md`.

#### Live QA: slice 6 handoff (not executed)

Use Owner/QA with the existing migration flag On, then compare Off on an explicitly authorized disposable board. Observe the named endpoint in the network panel: app-shell bootstrap and the typed-client flag may bypass some legacy HTTP requests. Use non-member, Member and Admin accounts to verify the policy distinctions above. Do not delete a real board or remove a real companion; destructive actions require explicit QA approval.

| Endpoint | UI path / action |
| --- | --- |
| POST `/api/projects/create` | Board → Ctrl+K → **Create board** → create a disposable board in an authorized team; verify title/prefix/default columns. |
| POST `/api/projects/update` | Board → Ctrl+K → **Rename board**; also Settings → Board → ticket prefix (with its separate existing flag enabled), retaining old-prefix lookup. |
| POST `/api/projects/archive` | Settings → Board → **Board management → Archive board** → confirm; restore it from **Archived boards** to exercise the same endpoint's toggle. |
| POST `/api/projects/delete` | Settings → Board → **Board management → Delete board** → confirm, only for an approved disposable board; verify replacement board and hidden deleted content. |
| POST `/api/projects/leave` | As a disposable Member, Settings → Board → **Board management → Leave board** → confirm; verify user/owned-agent memberships disappear and the replacement board opens. |
| POST `/api/projects/removeMember` | Board → Ctrl+K → **Manage members** → remove an approved disposable member; Settings' team-member removal uses a different endpoint. |
| POST `/api/projects/setMemberRole` | As board owner, Settings → Members → **Make admin**, then **Remove admin**; Admin/Member/non-member callers must remain denied. |
| POST `/api/projects/boardTasks` | Cold-open `/project?id=<board>` or switch boards; inspect the board payload and denied-account 403. If the existing typed-client flag selects another URL, exercise this same-origin endpoint explicitly too. |
| POST `/api/projects/getAll` | Cold-open `/project?id=<board>` → inspect bootstrap metadata and switch boards; compare active-project present/absent bodies without spoofing the signed actor. |
| GET `/api/projects/getAllMinimal` | Cold-open app → Ctrl+K → board switcher / **Go to board**; verify `mode=ExtraMinimal` response and lifecycle permissions. If app-shell bootstrap fulfills the cache, make an authorized same-origin GET too; `Calendar` and repeated mode query arrays need explicit requests. |
| GET `/api/projects/getArchived` | Settings → Board → **Archived boards**; verify only the signed user's owned archived boards appear. |
| GET `/api/projects/getFavorites` | **No UI caller found** beyond the unused `Homepage.getAllProjectsMinimal` export. Use an authorized same-origin GET; preserve the current complete minimal-board list (do not reinterpret the name as a favorites-only filter). |
| GET `/api/projects/getFirst` | Open `https://app.hypertask.ai/unauthorized` → **Return to previous board**; use an account with an existing board unless fallback-board creation is explicitly approved. |
| GET `/api/projects/lastActivity` | Open the board switcher (desktop or mobile title sheet); verify recent-board ordering and the signed user's activity map. |

### Slices 7 and 8: shared project view writes (local; not shipped)

Ticket: https://app.hypertask.ai/detail/project-15/6968. Base: `ec99a373655696cde21180e0a9cb31ab0c0e53d1`, branch `htpr-6968-slice-7`. Slices 1–6 shipped in PRs 1104, 1122, 1127, 1132, 1135, 1140 and 1142. This slice covers ten view route files / thirteen write methods in `src/lib/api/project-writes/views/`; Pages retains all URL ownership. No UI, caller, controller, MCP, typed-client, flag-registry or App/Pages twin changes.

- Reuses `withTaskWriteFlag` and `taskWriteRoute`, with the same server flag `htpr-6923-app-router-writes` (Owner + QA). Off, missing authentication and flag-lookup failure invoke independently byte-pinned legacy; unsupported methods bypass preflight. Route loading/execution never retries legacy after a possible write.
- `update-order`, `reset-order` and `set-default-order` remain **signed-cookie-only**. Better Auth preflight never broadens authorization; the signed identity wins over a stale preflight identity and body/query/profile-cookie IDs. Default order retains owner/Admin policy, private-view filtering and built-in IDs; personal order keeps board access, deduplication and null reset.
- Preserves legacy auth/validation/catch boundaries, including null-body/actor-load exceptions outside catches, update's missing-project **401**, inaccessible-view **404**, create's stringified-error **400**, missing-label/managed-split **409**, smart-split creation **201**, serialization conflicts **409**, and historical **101** for incomplete switch/rename requests. A narrowly structural response type and view JSON facade carry 101 through the existing Pages dispatcher because Web `Response` forbids informational statuses; ordinary results remain real `NextResponse`s. Undefined JSON remains an empty Pages response, not a manufactured null/error.
- Filter locks, managed-split mutation fences, inherited column order/layout/show-archived/sort-stack semantics, tab-local unsaved settings, default-view updates, last-used rows, detach/delete ordering, serializable reset/smart-split retries, smart-tag payload/order cleanup, post-commit AI backfill and broadcasts retain their original order and failure policies. Switch and generic rename/delete retain their historical lack of a board permission check; tightening these is not this refactor.
- Up-front audit found five direct Pages compile/import harnesses; each now has pass-through `withTaskWriteFlag` stubs and ran against legacy before wrapping. The dynamic no-login harness also uses the existing pass-through stub and is executed for these ten routes only, with zero import skips. Source-reader suites continue examining unchanged Pages bodies.
- Focused verification: `tests/htpr-6968-project-views.test.cjs` **304 passed, 0 failed**, comparing pinned originals, Off/outage/On and direct Web requests for success, validation, unauthenticated and permission outcomes, exceptional statuses, signed identities, query arrays, failure boundaries, ordered effects and actual Pages HTTP bytes. Fourteen touched-route/controller regression files **436 passed, 0 failed**; the scoped no-login harness **2 passed**, covering ten routes with no import skips. Migration byte pins, changed-file ESLint (30 TS/CJS files) and `git diff --check` pass; no full lint/suite or build runs. Size: **749 non-relocated production lines** (2,122 additions + 12 removals − 1,385 independently proved legacy-mirrored lines); complete reset/smart-split helper blocks are byte-proved, and other mirrored lines use conservative same-route matching with at least eight non-whitespace characters.
- `sync-view` stays **byte-pinned legacy**, not wrapped or deleted. The scoped scanner rechecks **0 app / 0 native CLI / 0 e2e** tracked caller files and rejects an injected live-caller control. Generic URL construction was reviewed; no route constant/import/caller was found. Unknown external/runtime use is unproven, so slice 12 owns retirement review; its exceptional 101 must not be normalized. `projects/detail` remains reserved for sibling https://app.hypertask.ai/detail/project-15/6924.
- One final `npx tsc --noEmit --pretty false` exited **2: 15 inherited diagnostics, 0 new**, with no rerun, compared to the independently captured production baseline `0c5006f8f743808047bfdac06da4313a47706e29` with the same shared dependency install, exact inherited MCP line mapping and byte-identical AppSheet union-order normalization. This is an ancestor baseline, not a new production compile; a source fingerprint binds the result to the compiler inputs. The only later TS change removes one copied trailing space from the create-view handler; exact pre/post file hashes and reconstruction bind both compiler and contract-test evidence to that non-semantic cleanup without another tsc run. Evidence and measured results: `/home/valentin/.local/state/vcc-evidence/HTPR-6968/slice7/GATES.md`.
- Local-only delivery: no board writes, stash, push, PR, deploy or live mutations. Remaining risks are the extra Off auth preflight, unsupported historical 101 wire behavior, unchanged access omissions, and unverified live transaction/realtime/backfill behavior. Physical router transfer remains slice 12.

#### Live QA: slices 7 and 8 handoff (not executed)

Use Owner/QA with the existing migration flag On, then compare Off on an authorized disposable board at `/project?id=<board>`. Inspect the exact named network request; newer tab-local/client flags may bypass canonical switch/reset requests. Do not mutate real views or tags: smart-split deletion also removes its paired tag and references. Repeat denied/unauthenticated cases without tightening historical switch/rename/delete policy.

| Endpoint | Existing UI click path / action |
| --- | --- |
| POST `/api/projects/views/create-view` | Change a board filter → **Save View** (Shift+V) → **Save as additional view for team** / **Save as view for me only** → name → Save; also **Set as default board for everyone** and overwrite an existing name. |
| POST `/api/projects/views/update-view` | Saved view → change settings → **Save View → Save as current view**; also **Ctrl+K → Manage views → view settings → layout**, and the saved view's empty-column visibility. |
| POST `/api/projects/views/delete-rename-view` | **Ctrl+K → Manage views** → rename a normal saved view; verify its slug and board cache update. |
| DELETE `/api/projects/views/delete-rename-view` | **Ctrl+K → Manage views** → delete an approved disposable normal view; include an applied view with unsaved settings. |
| POST `/api/projects/views/switch-view` | Board header → select another normal saved-view tab, or **Ctrl+K → Go to views**; verify the network endpoint is called, not only tab-local navigation. |
| POST `/api/projects/views/unsaved-view` | Board → change filter/sort/columns without saving; reload; then compare canonical and URL-pinned tabs, including equal-settings cleanup. |
| POST `/api/projects/views/reset-to-default` | Unsaved board → header **Reset** / **Save View → Reset View** (`ResetCurrent`); click the board title/default view for `ResetToDefault`; confirm transient rows are detached before deletion. |
| POST `/api/projects/views/update-order` | **Ctrl+K → Manage views** → drag views into a new order or **Sort A→Z**; reload, retaining built-in and allowed private views. |
| POST `/api/projects/views/reset-order` | **Ctrl+K → Manage views → Reset to default**; confirm the user's saved order becomes null. |
| POST `/api/projects/views/set-default-order` | As Owner/Admin, **Ctrl+K → Manage views → Set current order as default for everyone**; Member must remain denied. |
| POST `/api/projects/views/smart-split` | **Ctrl+K → Add smart split** → name/prompt → create; verify 201, paired tag/view and AI backfill after commit. |
| PATCH `/api/projects/views/smart-split` | **Ctrl+K → Manage views** → smart split's settings → edit name/prompt → Save; verify references and refreshed slug. |
| DELETE `/api/projects/views/smart-split` | Same smart-split settings → **Delete smart split** → confirm, only for an approved disposable split/tag; verify reference and order cleanup. |
| Legacy POST `/api/projects/views/sync-view` | No tracked UI/CLI/e2e caller: no genuine click path exists. Keep unchanged for slice 12's external-use review, not a fabricated QA click. |
