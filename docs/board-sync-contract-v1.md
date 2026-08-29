# Board synchronization contract v1

**Web and Android share this payload contract while keeping separate local databases.** Web uses IndexedDB. Android uses SQLite WAL.

## Authority and scope

- Authenticated Hypertask APIs remain authoritative.
- The web read model stores one active-board snapshot per account.
- Web mutations remain online. Android may queue mutations locally.
- Realtime events trigger synchronization. They do not replace durable reconciliation.
- Clients never read the production database directly.

## Projection boundaries

**Task entities, project-scoped views, and Inbox membership are separate logical projections.** An API response or local startup snapshot may carry them together, but that does not make view or Inbox fields part of the task-entity contract.

- The board task projection owns its project boundary, active task entities, tombstones, and task mutation acknowledgements. It does not absorb view or Inbox fields.
- The view projection owns saved filter and sort settings plus the applied/default marker for one account and project.
- The Inbox projection owns canonical notification rows, split metadata, and server-derived notification-index membership.
- Web may co-locate task and view projections in one IndexedDB snapshot to remove a startup request. Android may keep them in separate SQLite tables.
- Clients may cache Inbox membership as a derived index. It is not a second canonical notification copy and must be replaced by the next authoritative response.
- A wire response may bundle projections, but a view or Inbox shape change must not silently change task projection v1. Version the changed projection and keep missing newer metadata backward compatible.

Selecting a saved view updates local UI first on Android, then uses its durable FIFO queue and stable idempotency key for the existing apply-view operation. Web keeps its existing online mutation path. Both clients reconcile the server's applied/default marker, and cached view settings never grant project access.

## Snapshot projection

The shared fixture is `tests/fixtures/board-sync-v1.json`.

Every snapshot contains:

- `contractVersion` and local `schemaVersion`;
- stable `accountId` and `projectId` boundaries;
- server project metadata;
- active tasks with stable IDs, status, timestamps, section placement, and relations required by the board;
- saved views required to reproduce the active board;
- `tombstones` for archived or deleted entities when delta transport is introduced; and
- an opaque `nextCursor` owned by the server.

The web store normalizes tasks as `tasksById` plus `taskOrder`. Derived sections and filters are recomputed after restore.

## Cursor semantics

**Version 1 uses a full authenticated snapshot for reconciliation.** The current realtime payload is an invalidation signal, so the client fetches a fresh snapshot after a change or reconnect.

The future delta endpoint must return an opaque cursor. Clients must not construct or compare cursors. The server must use a stable `(changedAt, entityType, entityId)` order so concurrent changes cannot be skipped.

## Mutation envelope

Android queued mutations use this envelope:

```json
{
  "contractVersion": 1,
  "clientMutationId": "device-installation-id:monotonic-sequence",
  "accountId": 6,
  "projectId": 15,
  "entityType": "task",
  "entityId": 26723,
  "operation": "move",
  "baseVersion": "opaque-server-version",
  "createdAt": "2026-08-09T08:00:00.000Z",
  "payload": {}
}
```

- `clientMutationId` is stable across retries.
- The server returns the same acknowledgement for duplicate IDs.
- Permanent authentication, authorization, and validation errors do not retry.
- Network errors, `429`, and retryable `5xx` responses use bounded backoff.
- Server state wins unresolved conflicts. The acknowledgement returns the canonical entity for local replacement.

The web read model keeps its existing online mutation path. It does not create an offline mutation queue.

## Authentication and account changes

- Browser requests use the existing signed-in session.
- Android uses Hypertask OAuth 2.1 with PKCE, verifies callback state, and derives the stable account boundary from the signed token's `userId` claim. It does not copy browser cookies or pasted tokens.
- The native refresh protocol is already deployed through [PR #2571](https://github.com/valentinyeo/hypertasks/pull/2571) and covered by `tests/oauth-mobile-refresh.test.cjs`. A client registered through `POST /oauth/register` with both `authorization_code` and `refresh_token` grants receives a one-hour access token plus an opaque 90-day refresh token from `POST /oauth/token`. Refresh tokens rotate atomically, are single-use, are stored only as hashes server-side, and are protected by Android Keystore on the device. Replay or `POST /oauth/revoke` revokes the active token family.
- Android v0.21's one-time client-registration migration is a rollout dependency. A legacy client that has not registered the `refresh_token` grant keeps its legacy 90-day access-token behavior and must not call the refresh flow.
- Access-token expiry or a refresh-network failure is a transport state, not a cache-invalidating event. Android preserves cached data and stable `clientMutationId` values across renewal, but a transport failure never creates or extends offline authorization.
- Every local record is keyed by account and project.
- Reads fail closed on account, project, contract, or schema mismatch.
- Browser local snapshots may render while authorization is pending, but only from the IndexedDB key for the signed-in account and current project. This display state never grants access or suppresses server checks.
- Android may render a cached project offline only while a persisted authorization lease from the last successful project-access check is unexpired. The lease is bound to the account, project, and native token family and lasts no more than 24 hours. Transport errors never extend it. Expiry hides the project until access is revalidated, while preserving encrypted cache and queued mutation data.
- A definitive access denial, account switch, replay revocation, or logout invalidates the Android lease immediately and hides the cached project.
- The global board query carries an account owner marker, rejects data from another active account, and resets/refetches immediately when the account changes.
- Warm query data may resolve access only when it carries the authenticated network-origin marker and no authorization refetch/error is active; IndexedDB hydration changes that marker and can never authorize itself.
- A `boardTasks` 403 or a project missing from the authenticated `/getAll` response purges the browser's React Query board state and keyed IndexedDB record, then soft-navigates to the boards home. Transport errors do not revoke the local display.
- Disabling the read model makes local-origin query data unusable synchronously, then resets/refetches the authoritative query so `?local_db=0` is a true same-page rollback.
- Full web logout coordinates open tabs and waits for confirmed IndexedDB deletion. If deletion remains blocked, logout stops with an explicit instruction instead of leaving local board data behind.

## Realtime and missed events

- A board event schedules one debounced server reconciliation.
- A reconnect after a real disconnect also reconciles.
- The initial realtime connection does not duplicate the mount fetch.
- Full snapshots remove entities absent from the authoritative response, preventing stale tasks from surviving missed events.

## Pilot controls and measurement

- `?local_db=1` enrolls the browser and persists enrollment.
- `?local_db=0` is the immediate browser-level kill switch.
- Authenticated Board and Table routes enable the web read model by default.
- `NEXT_PUBLIC_SYNCED_BOARD_CACHE=false` provides a deployment-wide rollback that overrides URL and persisted opt-ins.
- Every pilot readiness event includes `analytics_surface=authenticated_app`, `app_hostname`, `route_family=project`, device class, source, and duration. Measurement version 3 records the first painted board frame rather than the earlier query publication.
- PostHog comparisons must filter to `app_hostname=app.hypertask.ai` and `analytics_surface=authenticated_app`. This excludes the marketing site.

## Shared scenarios

Both clients must cover clean install, warm start, revoked board access, account switching, process death, reconnect, duplicate retry, concurrent server edit, archive/delete, schema mismatch, expired session, blocked deletion, and full logout.

The web read model covers warm snapshots, reconciliation, schema/account rejection, rollback, and logout now. Android owns SQLite migrations, its mutation queue, and native UI state.
