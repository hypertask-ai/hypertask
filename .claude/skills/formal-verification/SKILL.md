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
| chat-send-queue | `verification/formal/chat-send-queue/ChatSendQueue.tla` | `src/lib/aiChat/sessionMessageQueue.ts`, `src/lib/aiChat/queuedMessageOrder.ts`, `src/hooks/MultiPages/AIChat/aiChatSend.ts`, `src/hooks/MultiPages/AIChat/useAiChatSessions.ts`, `src/app/api/ai-chat/add-message/route.ts`, `src/app/api/mcp/chat/pending/route.ts` | `4809d5d15a` |

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
| `MessageConserved` | holds | Every submitted message is in exactly one of a chat's queue, in flight, or delivered. |
| `DoneNotQueued` | holds | A message whose send finished is not left in any chat's queue. |
| `FailedSendKeepsQueued` | holds | After a send fails, that message is still in the queue. |
| `ChatSwitchKeepsQueue` | holds | While another chat is open, no unfinished message leaves its queue. |
| `QueueOrderKept` | holds | A message is delivered only after every message queued before it. |
| `QueuedStoredBeforeReply` | holds | A queued human message is stored with a `createdAt` that sorts before the reply row it names. |
| `StoppedReleasesSend` | holds | After Stop, Send is not held any more. |
| `StoppedStreamCloses` | holds | Stop closes the stream. |
| `ReplyEndReleasesSend` | holds | A finished reply never keeps the Send slot. |
| `AcquisitionWindowKept` | holds | A pending-message poll never abandons the transaction queue before the 5000 ms `maxWait` the route passes. |
| `AcquisitionRetried` | holds | A poll whose first transaction acquisition failed, before the callback ran, is retried once. |
| `AcquisitionAttemptsBounded` | holds | A poll opens at most two transactions. |
| `AcquisitionNotReplayed` | holds | A transaction that already ran its callback is never retried. |

Four checks replay the four times this class of bug reached production, and a fifth guards the acquisition retry. Each sets constants in its own config; the current model sets the pre-fix behaviour off.

| Check | Pre-fix behaviour it encodes | Property it breaks |
|---|---|---|
| `chat-send-queue-7785` (HTPR-7785, `db3ed0bc5f`) | the queued human row kept its insert time instead of the reply row's `createdAt - 1`, so history sorted it after the reply it waited for | `QueuedStoredBeforeReply` |
| `chat-send-queue-7767` (HTPR-7767, `f7844f1b5e`) | one in-memory queue per mounted chat, emptied when the chat changed | `MessageConserved`, `ChatSwitchKeepsQueue`, `FailedSendKeepsQueued`, `QueueOrderKept` |
| `chat-send-queue-7794` (HTPR-7794, `6b644aa7cd`) | Stop left the stream open and the send slot held | `StoppedReleasesSend`, `StoppedStreamCloses` |
| `chat-send-queue-9111` (HTPR-9111, `30a65fb461`) | Prisma's default 2000 ms `maxWait` with no retry of a `P2028` before the callback ran | `AcquisitionWindowKept`, `AcquisitionRetried` |
| `chat-send-queue-9111-replay` (guard, not a past bug) | retrying a `P2028` that arrived after the callback had already run | `AcquisitionNotReplayed` |

Each model action stands for one step in the code:

| Action | Code |
|---|---|
| `Compose`, `Enqueue` | the composer, then the `shouldQueue` branch of `handleSendMessage`: `persistentQueue.enqueue`, `prepare`, and `queue.set` |
| `SendQueued` | `drainQueuedMessage`: the head of `persistentQueue.get(sessionId)` goes to `handleSendMessage(next.content, { queuedMessage: next, sessionId })`, which captures the originating session |
| `Accept`, `Refuse` | the `fetch(chatRoute)` response, so `queueAccepted` or a refusal; the queue keeps the message until the send returns `true` |
| `ReplyStored` | the reply row `precedesMessageId` names exists with its own persisted `createdAt` |
| `Accept` (stamp) | `resolveQueuedMessageCreatedAt` in `POST /api/ai-chat/add-message`: `role = "human"` and a `precedesMessageId` becomes `reply.createdAt - 1`, otherwise the insert time |
| `ReplyEnd` | `consumeAiChatStream` reaching its `done` event, then `settleSend` and `drainQueuedMessage(completedSessionId)`, which removes the message from its originating session's queue |
| `Stop` | `handleCancelStream`, then `clearStreamingState` and `settleSendRef.current()` |
| `Switch` | `sessionQueue.sessionId = currentSession?.id`, and the queue the hooks read for the displayed chat |
| `PollStart` to `AcquisitionFail` | `GET /api/mcp/chat/pending`: `prisma.$transaction(callback, { maxWait: 5000 })`, the `transactionStarted` guard, one retry on a `P2028` before the callback, and no retry after it |

`QueuedStoredBeforeReply` fails on `chat-send-queue-7785` like this: a message is queued and sent, its reply row is written first, and the accept writes the human row with the insert time, which is later than the reply's `createdAt`. History then shows the answer above the question that waited for it. The model covers both interleavings; the back-dated stamp holds when the reply row is written first and when it is written after.

`MessageConserved` fails on `chat-send-queue-7767` like this: a message is queued in the open chat, the person switches to another chat, and the old queue is emptied, so the message is in no queue, not in flight, and not delivered. `ChatSwitchKeepsQueue`, `FailedSendKeepsQueued` and `QueueOrderKept` fail on the same clear.

`StoppedReleasesSend` and `StoppedStreamCloses` fail on `chat-send-queue-7794` like this: a reply streams, the person presses Stop, and the pre-fix client neither closes the stream nor releases the send, so Send stays dead and nothing queued behind it drains.

`AcquisitionWindowKept` and `AcquisitionRetried` fail on `chat-send-queue-9111` like this: the only transaction slot is held by another request, the poll waits out the pre-fix 2000 ms limit, and the route returns 500 without a second attempt, so the pending messages wait for the next poll.

`AcquisitionNotReplayed` fails on `chat-send-queue-9111-replay` like this: the first transaction enters its callback, throws a `P2028` there, and a retry decision that ignores `transactionStarted` runs the callback a second time.

Three mutations were run against this model to prove the properties can fail. Each was applied to a copy of the spec and reverted.

| Mutation | Property that caught it | Shortest path |
|---|---|---|
| `ReplyEnd` removes from `queue[active]` instead of the originating queue | `DoneNotQueued`, `MessageConserved` | `Compose`, `Enqueue`, `SendQueued`, `Accept`, `Switch`, `ReplyEnd` |
| `ReplyEnd` clears `queue[active]` to `<<>>` | `MessageConserved` | `Compose`, `Enqueue`, `SendQueued`, `Accept`, `Switch`, `ReplyEnd` |
| `SendQueued` pops the head before the send is acknowledged | `MessageConserved`, `FailedSendKeepsQueued` | `Compose`, `Enqueue`, `SendQueued`, `Refuse` |

`node verification/formal/chat-send-queue/repro.cjs` drives the real `createSessionMessageQueue`, `createAiChatSend` and `drainQueuedMessage` with a stubbed transport through the failed-send and chat-switch traces, and the real `resolveQueuedMessageCreatedAt` through the 7785 trace with the reply row written first. It prints the queue after the failed send, the order, the switch result, the current back-dated `createdAt`, and the `createdAt` the pre-fix code would have written, and exits 0 only while today's code keeps every message and sorts the queued one before its reply.

Bounds: two messages in one chat, a second chat that holds none, one send at a time, one in-flight message with its originating session captured separately from the displayed chat, one poll with the single transaction slot held and at most two transaction attempts. Time is modelled in 1000 ms ticks: the current model passes 5 ticks of `maxWait`, the pre-fix variant 2. The model assumes the poll's `P2028` either arrives before the callback or while it runs, and that the reply row's `createdAt` can precede the queued human row's insert, which is the case the fix handles. Not covered: attachment preparation failing between the composer and the queue, Stop before the server accepts the send, parallel streams, the 2 second drain interval and its retry delays, a reload that rehydrates the queue from sessionStorage, the `FOR UPDATE` wait inside the transaction, the agent heartbeat refresh, and the delivery write itself.

## When a covered file changes

1. Run the check before you read the diff.
2. Decide whether the changed steps still match the model: a step that was one action is now two, a branch moved, a value now has a different range. Update the model from the code, never from the result.
3. If a property that held now fails, the code is wrong, not the model. Leave the property alone, report the finding with its path, and do not fix product code in a verification change.
4. Move the `Confirmed against` commit forward only after the model describes the code again.
5. Add a covered file to `covered` in its `tests/formal-*.test.cjs`, which makes a pull request that touches it run the check.
6. A new check means a model, its `.cfg` with `SPECIFICATION` and `CONSTANTS` only, an entry in `verification/formal/checks.json`, and one `tests/formal-*.test.cjs` that runs the runner for it. The runner adds one `INVARIANTS` line per property.

`/maintain-formal-verification-skill` is the pstack loop for the merges and edits that skipped this skill.
