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
| AI tree, 50-node chain, unlimited depth | 51 | 3 | Production helper delegate calls: root lookup, shared authorized-board lookup, one recursive subtree query; exact serialized tree and key order match |
| AI tree, 50-node four-level fixture | 5 | 3 | Existing tree regression fixture; archived children, deleted/inaccessible subtree pruning and depth-limit omission of `children` remain unchanged |
| AI tree, depth 0 / depth 1 | 1 / 2 | 1 / 2 | Existing shallow-query paths retained; ancestor lookup remains its existing two reads |
| Page GET, PATCH, versions, archive and restore access preflight | 2 | 1 | Actual page service and routes against the same isolated store; page projection, 401/404 bodies, conflict/validation errors and mutation arguments match baseline |
| `listReport` populated entry relations | 4 | 1 | Generated Prisma SQL planner adapter calls, with identical decoded JSON, access/filter arguments, 1000-row limit, ordering and `canManage` behavior |
| Agent detail selected agent/membership/board/team read | 4 | 1 | Generated Prisma SQL planner adapter calls with identical selections and decoded relation JSON; other detail reads are unchanged |
| Agent PATCH using an owned canonical UUID | 3 | 2 | Scalar ownership/slug read delegate calls, excluding the update; no initial full owned-name list, still one fresh collision-safe slug calculation after mutation |
| Guest board owner safety check | 2 | 1 | Generated Prisma SQL planner adapter calls plus actual guard/delete-order contract comparison; task enumeration and all ordered deletes are unchanged |
| Email-code login refreshed User/UserSetting/UserPicture | 3 | 1 | Generated Prisma SQL planner adapter calls; full response, cookie values, missing-user fallback and side-effect order match baseline |

The recursive subtree query receives board IDs from the existing `getProjectWhere` predicate rather than duplicating its owner/member policy in SQL. It filters access and Deleted status at every recursive edge, so an accessible grandchild behind a denied or deleted parent cannot appear. Archived child tasks and a Deleted root retain their existing treatment. A bigint depth parameter preserves valid depth values above the PostgreSQL integer range. The original ancestor cycle/access/depth errors are unchanged.

Page lookup accepts an optional authenticated `userId` and combines the same Normal-project, team-scoped task predicate with the unique page lookup. `taskAccessWhere` can omit the task ID when used on the page's task relation. All five operations across the four touched route files use this predicate instead of a second task query. Calls without `userId`, including existing MCP consumers, keep exactly their old selection and unfiltered service contract. Existing cookie/profile authentication is intentionally retained here. No write/access policy is widened to teamless or archived boards, and no new task-status restriction is added.

Agent UUID fast lookup still checks `userId`. It falls back to the full name resolver on a miss, preserving UUID-shaped slugs, suffix collisions, trimmed IDs, case-sensitive ID matching and existing 404s. Slug-based PATCH still loads names before and after a rename; the second read is not redundant because names may have changed. Unknown UUIDs can incur one extra lookup before the preserved slug fallback.

### Named-hot-path audit and remaining work after slice 3

- Section 5 tree: ancestor batching was already present. This slice replaces breadth-wise subtree round trips with one recursive subtree read after the root and shared board-access reads. Depths 0 and 1 stay at their existing budgets. For a leaf requested at depth 2 or unlimited depth, the constant three-read path can cost one more read than the former two-read path; no universal latency improvement is claimed.
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
