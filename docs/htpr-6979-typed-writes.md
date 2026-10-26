# Typed section and notification writes

Ticket: https://app.hypertask.ai/detail/project-15/6979

Section and notification writes always go through the typed browser-side clients. The feature flag that gated them, shipped on 2026-10-06, was removed in HTPR-8004 after it had been on for everyone since 2026-10-09. There is no server behavior, permission, route or authorization change.

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

The typed clients add only `X-Hypertask-Client: htpr-6925`, the existing typed-client convention. Bare Axios, the bulk Axios wrapper and native fetch remain separate. Contracts warn with `console.warn` and preserve raw answers on drift; no retry or fallback write is introduced. Unknown response fields are retained. A section delete is an empty HTTP 204, exposed by Axios as an empty string, not the service's stripped JSON. Native archive validation uses a response clone and cannot consume the caller's body or turn malformed JSON on an otherwise successful response into a failed action. Native HTTP status handling is unchanged.

Leaf components call the typed writers directly. Existing optimistic seen/removal/reorder changes, reconciliation after failure, cache patches, persistence ordering, undo storage and Undo behavior remain unchanged.

## Deliberate boundaries

- Undo remains the existing legacy restore path, including archive timestamp grouping and bulk restore. No new undo behavior or stored-data shape is introduced.
- Task-detail read tracking (`getByTask` and comment `updateSeen`) and task-based unread toggling remain legacy. This slice adopts direct notification-row read state, not the comment read-tracking system.
- Task-only notification cleanup, Learn tutorial completion helpers, Inbox Zero, notification preferences, splitting and snoozing remain legacy. They do not share the adopted inbox-row request shape, or represent a separate operation.
- Column visibility/view writes and automatic assignment remain legacy. The selected transport does not gate any saved-view or permission behavior.
- The server already authenticates these routes and scopes writes to the signed user. The typed clients change diagnostics only, not authorization, and need no new server gate.

## Verification

Focused tests cover caller bodies, descriptors, inferred response/producer types, malformed nested data, future fields, empty 204, raw drift, native response ownership, unchanged echo headers, one-request rejection, typed adoption, optimistic ranking before persistence, failed-write settling and cache/refetch parity. Tests use current source and fixtures, never git history. Only changed-file ESLint, focused touched-file/client tests, feature flag/gate tests and project typecheck run, not a full suite or full lint.
