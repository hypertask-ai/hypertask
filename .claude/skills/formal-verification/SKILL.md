---
name: formal-verification
description: "Model-check the state machines where a bug costs money or loses a customer's event: seat quantity reconciliation under the Redis lease, and board webhook delivery retries. Use for /formal-verification, 'is the seat billing still correct', 'recheck the model', or any change to the files listed under Checks."
---

# Formal verification

TLC, the TLA+ model checker, walks every order of steps in a small model of the code and names the shortest path that breaks a property. A test checks the cases someone thought of; this checks every interleaving inside the bounds below.

## Run

```sh
node scripts/formal-verification/run.mjs              # every check
node scripts/formal-verification/run.mjs seat-billing # one check
```

TLC runs once for each property, on its own generated config, so a property expected to hold is explored to the end of the state space. A full run takes about 15 seconds.

Exit 0 means every property matches its record in `verification/formal/checks.json`. Exit 1 prints the property that changed and its counterexample. Exit 2 means an unknown check name.

The first run downloads TLC 1.7.4 to `~/.cache/hypertask-tlc`, pinned by sha256 in the record, and uses `java` from PATH. Set `TLA2TOOLS` to a jar and `JAVA` to a runtime to skip the download. Java 11 or later.

## Read a result with the statechart skill

Read every result, pass or fail, with the pstack `/statechart` skill. It turns each violated property into the shortest path in the words of the product, and draws the whole machine when nothing breaks. Copy none of its commands, options or paths into this file: they change between releases.

## Checks

| Check | Model | Covers | Confirmed against |
|---|---|---|---|
| seat-billing | `verification/formal/seat-billing/SeatBilling.tla` | `src/lib/syncSeatBilling.ts`, `src/lib/seatBillingLock.ts` | `616b6c73f8` |
| webhook-retry | `verification/formal/webhook-retry/BoardWebhook.tla` | `src/lib/mcp/webhooks/outboxDelivery.ts`, `src/lib/mcp/webhooks/queue.ts`, `src/lib/mcp/webhooks/events.ts` | `616b6c73f8` |

### seat-billing

| Property | State | In plain words |
|---|---|---|
| `JoinNeverDecreases` | holds | A run that is not the nightly reconcile never asks Stripe for a lower quantity than it read. |
| `ReconcileMatchesSeats` | violated, recorded finding | After the nightly reconcile finishes and nothing has changed the seats since, the billed quantity equals the seat count. |
| `LeaseExcludesOverlap` | violated, recorded finding | Two runs are never inside their read-then-write window at the same time. |

Each model action stands for one call in the code:

| Action | Code |
|---|---|
| `Acquire`, `Release`, `LeaseLost`, `Abort` | `withTeamSeatBillingLock`: `SET NX PX`, renew every 15 seconds, `assertHeld`, release in `finally` |
| `EditSeats` | the mutation callback `mutateAndSyncSeatBilling` runs while the lease is held |
| `ReadDesired` | `adapter.resolveQuantity`, which is `resolveSeatQuantity` |
| `ReadItem` | `retrieveCurrentSubscriptionItem`, a live `stripe.subscriptionItems.retrieve` |
| `NoWrite`, `Write` | the `desiredQuantity === currentQuantity` test and the `!exact` decrease guard, then `updateSubscriptionItem` |
| `Landed`, `Answered`, `TimedOut` | the Stripe call: the write is applied, the response arrives, or the 15 second timeout fires while the request stays in flight |

`ReconcileMatchesSeats` fails like this. A run raises the quantity and its Stripe call times out, so `reportFailure` records an error and the run returns `Error`, but Stripe still applies the write. Another run lowers the seats. The nightly reconcile reads the item before the late write lands, sees the old quantity, decides nothing is due and returns `OK`. The late write then lands and the team pays for a seat it removed. `node verification/formal/seat-billing/repro.cjs` replays it against the real `syncSeatBilling` with a stub Stripe: it prints `join: "Error"`, `reconcile: "OK"`, `seats: 1`, `billed: 2`, and exits 1 while the finding stands.

`LeaseExcludesOverlap` fails like this: a run loses its lease, the code keeps running it until the next `assertHeld` throws, and a second run acquires the lease, so both sit in the window. The lock serializes runs only while it is held.

Bounds: one team with one subscription item, seat counts 1 and 2, two runs. The lease is atomic and `assertHeld` throws where the code calls it; seat edits happen only inside a run, because every seat path calls `mutateAndSyncSeatBilling`. Not covered: pointer repair, pending-cancellation repair, the snapshot refresh, proration choice, Stripe idempotency keys, Redis, comped teams.

### webhook-retry

| Property | State | In plain words |
|---|---|---|
| `AttemptsBound` | holds | A delivery row never records more attempts than `BOARD_WEBHOOK_MAX_ATTEMPTS`. |
| `PostsWithinCap` | violated, recorded finding | A delivery is never posted to the subscriber more times than the cap allows. |
| `SuccessNotReportedFailed` | violated, recorded finding | A delivery whose endpoint answered 2xx is never marked failed. |

| Action | Code |
|---|---|
| `Claim` | the `updateMany` that takes the row while it is pending, retrying, or processing with a stale lease |
| `PostOk`, `PostFail` | `postSignedWebhook`, returning 2xx or a failure |
| `Record` | the fenced `updateMany` whose `processingAt` is still this claim's time, then the attempt row |
| `FenceMiss` | the same write when the lease went stale or another claim took the row, so the fence matches nothing |
| `LeaseStale`, `Sweep` | `PROCESSING_LEASE_MS` passing, then the sweep that returns the row to `retrying` with one more attempt |
| `Exhaust` | the sweep marking rows failed once `attemptCount` reaches the cap |
| `PostPastBound` | the model stops counting posts at `MaxPosts`, so a stuck claim cannot grow the state space |

`SuccessNotReportedFailed` fails like this: a worker claims the row and posts, the endpoint answers 2xx, and the 5 minute lease goes stale before the worker writes. The sweep returns the row to `retrying`, the worker's fenced write matches no row, so the success is dropped. A later post fails, the attempts reach the cap, and the row ends `failed` although the endpoint received the event.

`PostsWithinCap` fails like this: while the sweep has not run yet, a stale `processing` row can be claimed again by another worker, which posts and is fenced out in turn, so the endpoint receives more posts than the cap while `attemptCount` stands still.

Bounds: one delivery row, two workers, two attempts, three posts, no retry delays (a claim is allowed whenever the row is pending or retrying). The post is not gated on the lease, because the code posts first and fences only the write. Not covered: the 30 day retention delete, authorization and cancellation, the retry queue publish (the sweep is the backup), `src/lib/agentWebhooks/delivery.ts`, and the sweep lease in `src/pages/api/queues/sweep.ts`.

## When a covered file changes

1. Run the check before you read the diff.
2. Decide whether the changed steps still match the model: a step that was one action is now two, a branch moved, a value now has a different range. Update the model from the code, never from the result.
3. If a property that held now fails, the code is wrong, not the model. Leave the property alone, report the finding with its path, and do not fix product code in a verification change.
4. Move the `Confirmed against` commit forward only after the model describes the code again.
5. Add a covered file to `covered` in its `tests/formal-*.test.cjs`, which makes a pull request that touches it run the check.
6. A new check means a model, its `.cfg` with `SPECIFICATION` and `CONSTANTS` only, an entry in `verification/formal/checks.json`, and one `tests/formal-*.test.cjs` that runs the runner for it. The runner adds one `INVARIANTS` line per property.

`/maintain-formal-verification-skill` is the pstack loop for the merges and edits that skipped this skill.
