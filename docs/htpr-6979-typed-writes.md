# Typed section and notification writes

Ticket: https://app.hypertask.ai/detail/project-15/6979

`htpr-6979-typed-writes-sections-notifications` is a feature flag shipped on 2026-10-06, defaulting to Owner + QA. It is independent of the earlier typed read/property flags. It selects browser-side diagnostic clients only: no server behavior, permission, route or authorization change. OFF and unresolved values keep the original calls, bodies, query strings, transports and error handling.

## Production caller inventory

| Write | Existing route | Adopted caller |
| --- | --- | --- |
| Create section | POST `/api/section/create` | Ctrl+K Add Column via `commands.tsx` and `generalCommandActions.ts` |
| Rename section / done setting | POST `/api/section/update` | Manage Columns name and finished-ticket setting |
| Reorder section | POST `/api/section/update` | Manage Columns drag and board header drag in `Homepage.tsx` |
| Delete section | POST `/api/section/update` | Manage Columns Delete, sending the full cached section with `deleted: true` |
| Mark notification read / toggle unread | GET `/api/notifications/markAsUnseen?notificationId=...&seen=...` | Inbox row opening and U shortcut, via the existing Inbox API helpers |
| Archive notification | GET `/api/notifications/markAsDone?id=...&taskId=...&userId=...&type=...` | Shared inbox focus hook, including task/detail/board callers and tutorial query |
| Bulk archive notifications | POST `/api/notifications/(un)archiveBulk` | Shared inbox focus hook, preserving the Axios wrapper and socket echo header |
| Unarchive notification | POST `/api/notifications/unArchiveNotificationById` | Inbox Archive row action / E shortcut |

Six descriptors in `src/lib/api/typedClient.ts` use the browser-safe `sectionWrites.ts` and `notificationWrites.ts` schemas. Input types come from `z.input`, answers from `z.output`; each descriptor has its actual method/path, query/body, success and status-indexed error schemas. There is no unused `/api/section/rename` descriptor: `renameColumnAPI` has no production call site. Section updates keep the cached model's optional ID type; this does not add a guard or change the legacy request.

## Wire and UI parity

ON adds only `X-Hypertask-Client: htpr-6925`, the existing typed-client convention. Bare Axios, the bulk Axios wrapper and native fetch remain separate. Contracts warn with `console.warn` and preserve raw answers on drift; no retry or fallback write is introduced. Unknown response fields are retained. A section delete is an empty HTTP 204, exposed by Axios as an empty string, not the service's stripped JSON. Native archive validation uses a response clone and cannot consume the caller's body or turn malformed JSON on an otherwise successful response into a failed action. Native HTTP status handling is unchanged.

Leaf components choose writers immediately after `useFlag`, following the established typed-property pattern and satisfying the trusted production flag gate without changing it. The command factory receives the selected writer from its sole UI owner. Original legacy call expressions remain in place. Existing optimistic seen/removal/reorder changes, reconciliation after failure, cache patches, persistence ordering, undo storage and Undo behavior remain unchanged.

## Deliberate boundaries

- Undo remains the existing legacy restore path, including archive timestamp grouping and bulk restore. No new undo behavior or stored-data shape is introduced.
- Task-detail read tracking (`getByTask` and comment `updateSeen`) and task-based unread toggling remain legacy. This slice adopts direct notification-row read state, not the comment read-tracking system.
- Task-only notification cleanup, Learn tutorial completion helpers, Inbox Zero, notification preferences, splitting and snoozing remain legacy. They do not share the adopted inbox-row request shape, or represent a separate operation.
- Column visibility/view writes and automatic assignment remain legacy. The selected transport does not gate any saved-view or permission behavior.
- The server already authenticates these routes and scopes writes to the signed user. The feature changes diagnostics only, not authorization, and needs no new server gate.

## Verification

Focused tests cover caller bodies, descriptors, inferred response/producer types, malformed nested data, future fields, empty 204, raw drift, native response ownership, unchanged echo headers, one-request rejection, ON/OFF/unresolved adoption, optimistic ranking before persistence, failed-write settling and cache/refetch parity. Tests use current source and fixtures, never git history. Only changed-file ESLint, focused touched-file/client tests, feature flag/gate tests and project typecheck run, not a full suite or full lint.

Disposable local PR-build QA exercises create, rename, reorder and delete plus notification read, archive and unarchive with the flag ON and OFF, checking persisted server state and client headers. Evidence, the exact trusted production gate with its pinned parser, screenshots, short recording and delivery result live in `~/.local/state/vcc-evidence/HTPR-6979/writes2/`; `~/.local/state/vcc-evidence/HTPR-6979/premerge.md` binds the local build and evaluated flag states to the final source/commit. Local services are shut down immediately after QA. No PR, merge, board write or live flag change is part of this handoff.
