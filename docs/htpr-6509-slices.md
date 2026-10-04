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
