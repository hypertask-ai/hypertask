# `@hypertask/agent-sdk`

Build a TypeScript Hypertask agent around the existing run, activity, webhook, and task APIs. The package has no runtime or framework dependencies. SDK requests remain protected by the `htpr-6115-agent-sdk` and `htpr-6123-add-typescript-agent-sdk` flags.

## Hello world in under 30 minutes

1. Create a managed agent and copy its token and webhook secret into environment variables.
2. Configure its webhook for `run.created`, `run.prompted`, and `run.stopped`.
3. Install the package and an HTTP framework of your choice.
4. Mount the webhook before JSON parsing so the SDK receives the exact request bytes.
5. Mention the agent on a test ticket and watch its thought and response appear.

```bash
npm install @hypertask/agent-sdk express
```

```ts
import express from "express";
import { createAgent, MemoryDeliveryScheduler } from "@hypertask/agent-sdk";

const app = express();
const agent = createAgent({
  token: process.env.AGENT_TOKEN!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  scheduler: new MemoryDeliveryScheduler(),
});

agent.on("mention", async (run) => {
  await run.thought(`Reading ${run.ticket?.ticketNumber}.`);
  await run.respond("Hello from the Hypertask Agent SDK.");
});

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  agent.adapters.express({ distributed: false }),
);
app.listen(3000);
```

`createAgent` only constructs local objects and performs no network work. SDK requests identify themselves with `X-Hypertask-Agent-SDK: typescript`. Every delivery is preflighted through the run API before callbacks can execute; that API enforces both `htpr-6115-agent-sdk` and the owner-only `htpr-6123-add-typescript-agent-sdk` for SDK requests, and activity writes enforce them again alongside the activity flag. Until those flags are enabled for the token owner, SDK run requests intentionally answer as not found.

## API

`createAgent({ token, webhookSecret })` returns:

- `client`: authenticated Fetch-based API client and event registry.
- `handler(request, { scheduler })`: framework-neutral Fetch handler.
- `processDelivery(payload)`: worker entrypoint for a delivery recovered after restart.
- `on(event, callback)`: shorthand for `client.on`.
- `adapters`: handlers for Node HTTP, Express, Hono, Next route handlers, and Cloudflare Workers.

Events are `mention`, `assigned`, `chat`, `prompted`, and `stop`. Each callback receives the exact event prompt plus a current, bounded snapshot of the task or chat thread. Delayed webhooks can therefore include edits that happened after the triggering event; `run.prompt` remains the triggering text.

```ts
agent.on("assigned", async (run) => {
  await run.thought("Checking the ticket.");
  await run.task?.move("In Progress");
  await run.task?.comment("Work started.");
  await run.respond("I started this ticket.");
});
```

### Activity helpers

```ts
await run.thought("Planning the next action.");
await run.action("Opened the build log.", "https://example.com/build");
await run.respond("The build passed.");
await run.error("The upstream request failed.");
await run.ask("Which path should I use?", [
  { value: "safe", label: "Safe path" },
  { value: "fast", label: "Fast path" },
]);
```

If no activity succeeds within eight seconds, the SDK posts `Working on this.` automatically. `run.ask` creates an elicitation activity; the later choice arrives as a `prompted` event in `run.selection` (`activityId`, `value`, and `label`).

### Task helpers

`run.task` exists for task-backed runs and is `null` for Agent Chat runs.

```ts
await run.task?.move("QA");                 // section name or numeric ID
await run.task?.assign("me");              // user ID, email, name, agent ID, or me
await run.task?.comment("Ready for QA.");
await run.task?.update({ priority: 1 });
await run.task?.attach("https://example.com/report.pdf");
```

Every write claims a task lease, heartbeats it during long work, and releases it in `finally`. Activities, comments, updates, assignments, moves, and attachments use the existing retry-safe server contracts. Attachment MIME types are inferred from common filename extensions; pass `{ url, filename, contentType }` for other types. The SDK polls run status every five seconds and aborts local requests when any host receives a stop. Each activity and task helper also rechecks run status before writing. Handlers should stop external work when `run.signal` aborts.

## Adapters

Node and Express adapters default to distributed mode and require a durable `DeliveryStore`. Pass `{ distributed: false }` only when exactly one process receives webhooks. Every adapter also requires a `DeliveryScheduler` that durably records each delivery before `enqueue` resolves and retries `run` until it succeeds. `MemoryDeliveryScheduler` is the single-process implementation used above; it keeps deliveries in memory, so distributed and restartable hosts must pass a scheduler backed by a real queue.

### Plain Node HTTP

```ts
import http from "node:http";
http.createServer(agent.adapters.node({ distributed: false })).listen(3000);
```

### Hono

```ts
app.post("/webhook", agent.adapters.hono());
```

A Node-hosted Hono app can pass `{ distributed: false, scheduler }`. Distributed Hono deployments require both a durable delivery scheduler and a durable delivery store; the adapter returns 503 before dispatch when either is unavailable.

### Next route handler

Next and other restartable serverless hosts must provide their platform background scheduler and a shared durable `DeliveryStore`:

```ts
const agent = createAgent({
  token: process.env.AGENT_TOKEN!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  deliveryStore,
});

export const POST = agent.adapters.next(scheduler);
```

### Cloudflare Worker

```ts
export default { fetch: agent.adapters.cloudflare(scheduler) };
```

## Dry run

Set `dryRun: true` on `createAgent` (or run the process with `HYPERTASK_DRY_RUN=1`) to develop against real tickets without touching them. Reads still hit the API, so the run, ticket, and thread are the real ones, while every write is printed and skipped:

```ts
const agent = createAgent({ token, webhookSecret, dryRun: true });
// [dry-run] POST /mcp/comments {"task_id":101,"text":"<p>Work started.</p>"}
```

Pass `onDryRun` to collect the previews instead of printing them. Because nothing is written, a dry run may also replay a run that already finished, which is what `hypertask agent replay <runId>` re-sends into a local handler.

## Delivery safety

The SDK verifies HMAC-SHA256 over `timestamp.rawBody`, rejects timestamps outside five minutes, compares signatures in constant time, limits request bodies, and requires event and delivery headers to match their signed body fields. It acknowledges a run event only after durable enqueue; the worker then reads that run with the configured token and verifies the agent/task binding before dispatch.

The built-in `MemoryDeliveryStore` is deliberately single-process only. It has expiring owner-fenced claims and bounded retention, which is suitable for plain Node and local development. Next, Cloudflare, and other distributed adapters fail with 503 unless `deliveryStore.durable === true`. A durable implementation must make `claim`, `renew`, `complete`, and `release` atomic, reject expired or stale owners, and honor the supplied expiry values. Task writes use a unique lease token so delayed heartbeats or releases cannot affect a replacement lease.

`DeliveryScheduler.enqueue` must atomically persist the payload and deduplicate its `deliveryId` before resolving with `enqueued`; return `duplicate` when that ID is already queued or complete. The scheduler must retry a rejected `run` callback rather than complete the job. After a process restart, its worker must pass the stored payload to `agent.processDelivery(payload)` and retry rejected promises there too. Only replay payloads originally persisted by the verified webhook handler. A permanent 404 access check resolves the job without dispatch because the run no longer belongs to the token.

## Templates

```ts
import {
  createReplyOnlyAssistant,
  createScheduledBot,
  createTicketWorker,
} from "@hypertask/agent-sdk/templates";
```

- `createReplyOnlyAssistant`: replies to mentions, chat, and follow-up prompts without changing tasks.
- `createTicketWorker`: receives assigned tickets and exposes leased task helpers.
- `createScheduledBot`: exposes `run()` for a cron endpoint and needs no webhook secret.

OAuth marketplace installation, Python support, a hosted runtime, local tunnels, and package publishing automation are outside this package.
