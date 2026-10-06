# Typed client slices 2 and 3

Ticket: https://app.hypertask.ai/detail/project-15/6967

Slice 2/3 adoption uses only `htpr-6967-typed-task-reads`, defaulting to Owner + QA. OFF and unresolved states retain the exact legacy reads. Slice 1 settings readers remain unchanged on `htpr-6925-typed-api-client`; the two switches are independent.

## Route convention

`src/lib/api/typedClient.ts` exports small read descriptors: method, path parameters and path builder, query and body schemas, success schema, and status-indexed error schemas. `z.undefined()` means no input in that location. Caller inputs use `z.input`; successful wire answers use `z.output`. The descriptors describe existing routes, not a new server wrapper or response envelope. The optional `validate` policy defaults to synchronous checks; board detail declares `validate: "deferred"` because its payload scales with board size.

Concrete readers retain the original transport: Axios for description history and board detail, native fetch for cycles. They forward AbortSignal, make one request, and add `X-Hypertask-Client: htpr-6925`. Schema drift warns and returns raw parsed data; HTTP errors keep the existing rejection semantics. Error schemas document the wire answers without rewriting exceptions. Dates remain strings and loose objects preserve additional fields.

## Adopted reads

- GET `/api/tasks/{taskId}/description-versions`: existing history modal, including its unchanged restore mutation.
- GET `/api/tasks/cycle`: existing cycle picker, including search, cancellation and unchanged POST assignment.
- POST `/api/projects/boardTasks`: existing board hydration and warming hooks. This is a read despite using POST. The early bootstrap and React Query cache still win when populated; no second request is added to validate already-loaded data. Nested board parent/subtask projections are validated with the board answer.

Board detail returns the raw answer without synchronous parsing. In the browser, its diagnostic check runs via `requestIdleCallback` with a 1000 ms timeout, or `setTimeout(..., 0)` when idle callbacks are unavailable. The later check preserves the same mismatch warning and never replaces the returned data; non-browser reads skip deferred diagnostics. History and cycle remain synchronous. Slice 1 and flag OFF transports are unchanged.

The board schema deliberately describes a wire projection, not the broader hydrated `IProject` and `ITask` interfaces. Unknown producer fields remain intact for existing hydration. No new model or parallel cache is introduced.

## Deferred relation read and prerequisite correction

POST `/api/tasks/getAll?compat=htpr-6924` comes later, when it has a production frontend caller. Its unused descriptor, compact contracts, fixtures and tests have been removed; adding a caller now would duplicate board loading and negotiate another server flag. The parent/subtask wire projection used by the board remains.

The request named PR 1113 as new App Router board/relations routes. Actual merged PR 1113 adds shared entry checks; PR 1119 negotiates retirement of legacy project detail toward `/api/projects/boardTasks` and adds compact relations to the Pages task reader. This slice uses those shipped producers, not nonexistent App Router replacements. AI chat paging, writes and OpenAPI remain out of scope.

Local click-through exposed a prerequisite cycle-entry crash: the label supplied `null` shortcut keys to a tooltip expecting an array. Its value is now the empty array. This one-line crash repair is needed to open the picker under either switch state and does not require another feature flag.

## Verification

`tests/fixtures/typed-api-task-reads.json` contains real HTTP responses captured from the disposable local build as account 985, using only local seeded parent/subtask, history and cycle data. It includes unauthenticated and denied responses. Focused tests cover these fixtures, schema-negative controls, transport/error/cancellation parity, semantic producer types and invalid callers, ON/OFF/unresolved adoption, bootstrap preservation, and mutations remaining legacy.

Current browser proof and the gate ledger are in `~/.local/state/vcc-evidence/HTPR-6967/slice23-flag/`; `~/.local/state/vcc-evidence/HTPR-6967/premerge.md` binds the tested source to the final commit. OFF is a browser-only evaluated-flag override, including bootstrap flags, not a stored flag-mode change. Live verification still belongs to the later ship session.
