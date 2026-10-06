# Typed ticket property writes, first write area

Ticket: https://app.hypertask.ai/detail/project-15/6975

`htpr-6975-typed-writes` defaults to Owner + QA and is independent of the settings/read flags and `htpr-6923-app-router-writes`. It selects diagnostic typed clients, not new server behavior or authorization. OFF and unresolved states retain the original HTTP calls, bodies, transports and error handling.

## Adopted operations

| Property | Existing route | Caller |
| --- | --- | --- |
| Status / section | PUT `/api/tasks/moveTask` | Move picker, shared section mutation, detail next/previous-column action |
| Priority | POST `/api/priority/setPriority` | Task priority hook |
| Assignees | POST `/api/assignees/assign` | Task assignment hook, including assign/unassign intent and agents |
| Due date | POST `/api/tasks/setDueDate` | Natural-language and custom-calendar picker via existing helper |
| Start date | POST `/api/tasks/setStartDate` | Start-date picker via existing helper |
| Waiting on | POST `/api/tasks/waiting-on` | Person picker, including Nobody (clear) |
| Labels | POST `/api/labels/assignLabel` | Existing task-label toggle |
| Estimate | POST `/api/estimate/setEstimate` | Task estimate hook |

Each descriptor in `src/lib/api/typedClient.ts` has a production caller, method, path, query/body, success and status-indexed message/error schemas. Caller input types use `z.input`; answers use `z.output`. Contracts reuse the task-read relation projection. The 6923 request schemas are intentionally loose `z.custom` predicates in server modules, not browser-safe typed property contracts. Importing those modules would bring auth, Prisma, queues and realtime into the client. This slice describes their actual property requests without moving their code or changing server validation.

Bare Axios, the labels Axios wrapper and native fetch remain distinct. ON adds only `X-Hypertask-Client: htpr-6925`, following the established client convention. Validation warns and preserves raw answers on drift. Larger task answers from moves and date writes are diagnosed during idle time; no second request, automatic retry or fallback write is added. Native move callers keep their original status and JSON error handling. Existing optimistic updates, rollback, callback/refetch behavior and undo code stay in place.

## Deliberate boundaries

- Inline waiting-on clear in the shared `TaskInfo.tsx` remains legacy even ON. That file also exports unrelated late-detail UI; this request explicitly forbids touching files with unrelated exports. The person picker's Nobody action is typed. No unrelated component gets a dummy flag read just to pass the gate.
- Label creation edits the board's label definitions and can also assign the new label; it stays legacy. This slice adopts assignment of existing labels, not board-label administration or bulk writes.
- Generic `/api/tasks/single` updates have no property-panel caller for these operations. No unused update descriptor is added. Recurrence, custom fields, cross-board moves, archive/delete, sections and notifications writes are not adopted; sections and notifications are next PRs.
- There is no general priority/date/assignee/column undo today. Keep this unchanged rather than inventing it. Verify the existing adjacent task archive and Undo path after property edits. Archive currently clears the due date; Undo restores Normal status, not that date. Both ON and OFF preserve this behavior.
- Chat session paging contracts belong with chat adoption in https://app.hypertask.ai/detail/project-15/6971, waiting on Valentin. Adding descriptors without a caller here would be unused scaffolding.
- OpenAPI is deferred because no outside tool needs it yet. When one does, emit a deterministic spec from the settled descriptors, add auth and status metadata plus multipart/streaming exceptions, test schema/coercion/nullability fidelity, and add a CI drift check. Evaluate Zod's JSON-schema export before adding a bridge dependency.

## Verification and local-only decisions

Focused tests cover actual disposable-local HTTP fixtures, set/update/clear answers, unauthenticated failures, malformed nested values, deferred diagnostics, header/transport parity, request rejection without retries, semantic producer types, ON/OFF/unresolved adoption and optimistic rollback. Source-parity assertions protect original HTTP literals and mutation/undo callbacks.

The disposable runner has no QStash transport by default, so due-date scheduling initially returned 500 after saving. Final local QA supplies a loopback-only HTTP queue fixture with disposable credentials using a clean environment. It records publish/cancel requests without delivering jobs; it does not prove production queue delivery. No runner or product source was changed to suppress that failure. Priority persistence is verified through the API and after reopening, since the cached panel retains its old priority until reopening in both modes. Scoped ESLint uses the same existing bulk-suppression location as the normal lint command, with no baseline changes.

Evidence, the gate ledger, exact trusted production gate output, screenshots, short recording and delivery result live in `~/.local/state/vcc-evidence/HTPR-6975/writes1/`. `~/.local/state/vcc-evidence/HTPR-6975/premerge.md` binds account 985, local flag modes, evaluated ON/OFF overrides and tested source to the commit. No PR, merge, board write or live mode change is part of this handoff.
