# Task API consolidation: first slice

Ticket: https://app.hypertask.ai/detail/project-15/6509

Type: `[REFACTOR]`. No product behavior change or feature flag. Baseline commit: `33c5a4ad1a05b375185b42a6c1bd7b7115d63514`.

## Changed operations and compatibility

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

## Follow-up PRs

1. Section 1: remaining Pages task operations, project/section/notification writes, caller migrations and the MCP service adapter after the separate service-layer work. All 33 Pages task files remain.
2. Section 2: remaining route-entry loader adoption, project access promotion and domain interfaces, and other inline task-access checks. The existing task-access helpers already had production callers before this slice; no claim that this first PR creates their first callers.
3. Section 3: remaining REST JSON readers, page-ID parsers, team membership callers, webhook signature sharing and rate limiting.
4. Section 4: dead endpoints, external-only route organization and coordination with the separate response-envelope rollout. No dead endpoints are removed here.
5. Section 5: all named tree/session/bootstrap/page/time-report/agent/guest/login hot paths remain untouched.
6. Section 6: comment fan-out batching, legacy board loaders, archived inbox counts and payload narrowing of legacy parent/subtask relations. Payload narrowing needs a separately reviewed compatibility plan.
7. Section 7: Zod/OpenAPI-derived typed client and frontend adoption after schema conventions land.

The task-open loaders, app-shell bootstrap, `src/app/api/mcp` and `src/lib/mcp-server` are untouched. Only the shared MCP JSON-body helper receives an optional callback argument; its default contract has regression coverage.

## Verification

- Before implementation: `node --test tests/task-route-consolidation.test.cjs`, 16 passed, 0 failed. The same contract assertions are run after implementation.
- Regression commands and gate evidence are in `GATES.md`. The expanded run includes task-cycle, description-history, malformed MCP JSON, session resolution, cookie identity, property realtime, task-write choke points and task-single authentication tests.
- Full `npx tsc --noEmit -p .`: 15 unrelated diagnostics at baseline and after the change. The baseline native compiler used exit 2; the final default TypeScript 6.0.3 compiler used exit 1 after the shared dependency symlink changed externally. `tests/task-route-typecheck.cjs` reruns that exact command, accepts both compilers' diagnostic exit codes, and rejects any diagnostic not present in the baseline or unexpected compiler stderr. No changed production file has a diagnostic.
- `npm run lint` is scoped with ignore/unignore patterns to every changed TypeScript/CJS file; `git diff --check` checks whitespace.
- No full Next build or database-backed/live QA is claimed. The build script runs production migrations, which are outside this worktree-only, no-shared-state task.
