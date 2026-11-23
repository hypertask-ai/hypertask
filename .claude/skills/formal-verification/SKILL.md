---
name: formal-verification
description: "Model-check the state machines where a bug costs money, loses a customer's event, or loses a chat message: seat quantity reconciliation under the Redis lease, board webhook delivery retries, and the AI chat send queue. Use for /formal-verification, 'is the seat billing still correct', 'recheck the model', or any change to the files listed under Checks."
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
| chat-send-queue | `verification/formal/chat-send-queue/ChatSendQueue.tla` | `src/lib/aiChat/sessionMessageQueue.ts`, `src/lib/aiChat/queuedMessageOrder.ts`, `src/hooks/MultiPages/AIChat/aiChatSend.ts`, `src/hooks/MultiPages/AIChat/useAiChatSessions.ts`, `src/app/api/mcp/chat/pending/route.ts` | `4809d5d15a` |

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

### chat-send-queue

| Property | State | In plain words |
|---|---|---|
| `NoQueuedMessageLost` | holds | A message the person submitted is never dropped; it stays queued, in flight, stored, or answered. |
| `FailedSendKeepsQueued` | holds | After a send fails, that message is still in the queue. |
| `ChatSwitchKeepsQueue` | holds | While another chat is open, a queued message is never dropped. |
| `QueueOrderKept` | holds | A message is stored only after every message queued before it. |
| `StoppedReleasesSend` | holds | After Stop, Send is not held any more. |
| `StoppedStreamCloses` | holds | Stop closes the stream. |
| `ReplyEndReleasesSend` | holds | A finished reply never keeps the Send slot. |
| `AcquisitionBounded` | holds | A pending-message poll never waits for its transaction longer than `maxWait`. |
| `AcquisitionNotReplayed` | holds | A transaction that already ran its callback is never retried. |

Four checks replay the four times this class of bug reached production. Each sets one `Bug` constant in its own config; the current model sets all four to `FALSE`.

| Check | Pre-fix behaviour it encodes | Property it breaks |
|---|---|---|
| `chat-send-queue-7785` (HTPR-7785, `db3ed0bc5f`) | the drain popped a message before sending it, so a failed send left nothing to retry and the newer queued message went out first | `FailedSendKeepsQueued`, `QueueOrderKept` |
| `chat-send-queue-7767` (HTPR-7767, `f7844f1b5e`) | one in-memory queue per mounted chat, emptied when the chat changed | `ChatSwitchKeepsQueue` |
| `chat-send-queue-7794` (HTPR-7794, `6b644aa7cd`) | Stop left the stream open and the send slot held | `StoppedReleasesSend`, `StoppedStreamCloses` |
| `chat-send-queue-9111` (HTPR-9111, `30a65fb461`) | transaction acquisition waited with no `maxWait` and no retry | `AcquisitionBounded` |

Each model action stands for one step in the code:

| Action | Code |
|---|---|
| `Compose`, `Enqueue` | the composer, then the `shouldQueue` branch of `handleSendMessage`: `persistentQueue.enqueue`, `prepare`, and `queue.set` |
| `SendQueued` | `drainQueuedMessage`: the head of `persistentQueue.get(sessionId)` goes to `handleSendMessage(next.content, { queuedMessage: next, sessionId })` |
| `Accept`, `Refuse` | the `fetch(chatRoute)` response, so `queueAccepted` or a refusal; the queue keeps the message until the send returns `true` |
| `ReplyEnd` | `consumeAiChatStream` reaching its `done` event, then `settleSend` and `drainQueuedMessage(completedSessionId)` |
| `Stop` | `handleCancelStream`, then `clearStreamingState` and `settleSendRef.current()` |
| `Switch` | `sessionQueue.sessionId = currentSession?.id`, and the queue the hooks read for the displayed chat |
| `PollStart` to `PollRelease` | `GET /api/mcp/chat/pending`: `prisma.$transaction(callback, { maxWait: 5000 })`, the `transactionStarted` guard, and the one retry on `P2028` |

`FailedSendKeepsQueued` and `QueueOrderKept` fail on `chat-send-queue-7785` like this: a message is queued, a newer message is queued behind it, the head is sent, and the send fails. The pre-fix drain had already removed the head, so the older message is gone while the newer one is sent next.

`ChatSwitchKeepsQueue` fails on `chat-send-queue-7767` like this: a message is queued in the open chat, the person switches to another chat, and the old queue is emptied, so the message is never sent.

`StoppedReleasesSend` and `StoppedStreamCloses` fail on `chat-send-queue-7794` like this: a reply streams, the person presses Stop, and the pre-fix client neither closes the stream nor releases the send, so Send stays dead and nothing queued behind it drains.

`AcquisitionBounded` fails on `chat-send-queue-9111` like this: the only transaction slot is held by another request, the poll waits without a `maxWait`, and nothing bounds or retries the acquisition, so the pending messages wait forever.

`node verification/formal/chat-send-queue/repro.cjs` drives the real `createSessionMessageQueue`, `createAiChatSend` and `drainQueuedMessage` with a stubbed transport through the 7785 and 7767 traces and the 7785 ordering helper. It prints the queue after the failed send, the order, the switch result, and the back-dated `createdAt`, and exits 0 while today's code keeps every message.

Bounds: one chat with two messages, a second chat that holds none, one send at a time, one poll with the single transaction slot held. Not covered: attachment preparation failing between the composer and the queue, Stop before the server accepts the send, parallel streams, the 2 second drain interval and its retry delays, a reload that rehydrates the queue from sessionStorage, the `FOR UPDATE` wait inside the transaction, the agent heartbeat refresh, and the delivery write itself.

## When a covered file changes

1. Run the check before you read the diff.
2. Decide whether the changed steps still match the model: a step that was one action is now two, a branch moved, a value now has a different range. Update the model from the code, never from the result.
3. If a property that held now fails, the code is wrong, not the model. Leave the property alone, report the finding with its path, and do not fix product code in a verification change.
4. Move the `Confirmed against` commit forward only after the model describes the code again.
5. Add a covered file to `covered` in its `tests/formal-*.test.cjs`, which makes a pull request that touches it run the check.
6. A new check means a model, its `.cfg` with `SPECIFICATION` and `CONSTANTS` only, an entry in `verification/formal/checks.json`, and one `tests/formal-*.test.cjs` that runs the runner for it. The runner adds one `INVARIANTS` line per property.

`/maintain-formal-verification-skill` is the pstack loop for the merges and edits that skipped this skill.
