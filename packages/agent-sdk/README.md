# `@hypertask/agent-sdk`

Build a TypeScript Hypertask agent around the existing run, activity, webhook, and task APIs. The package has no runtime or framework dependencies.

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
import { createAgent } from "@hypertask/agent-sdk";

const app = express();
const agent = createAgent({
  token: process.env.AGENT_TOKEN!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
});

agent.on("mention", async (run) => {
  await run.thought(`Reading ${run.ticket?.ticketNumber}.`);
  await run.respond("Hello from the Hypertask Agent SDK.");
});

app.post("/webhook", express.raw({ type: "application/json" }), agent.adapters.express);
app.listen(3000);
```

The server-side `htpr-6115-agent-sdk` and activity flags must be enabled for the token owner. Until then, run APIs intentionally answer as not found.

## API

`createAgent({ token, webhookSecret })` returns:

- `client`: authenticated Fetch-based API client and event registry.
- `handler(request, { waitUntil })`: framework-neutral Fetch handler.
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

Every write claims a task lease, heartbeats it during long work, and releases it in `finally`. Activities, comments, updates, assignments, moves, and attachments use the existing retry-safe server contracts. A stopped run aborts local requests, and each task helper rechecks run status before writing. Handlers should also stop external work when `run.signal` aborts.

## Adapters

### Plain Node HTTP

```ts
import http from "node:http";
http.createServer(agent.adapters.node).listen(3000);
```

### Hono

```ts
app.post("/webhook", agent.adapters.hono());
```

A Node-hosted Hono app can pass `{ distributed: false, waitUntil: task => void task }`. Distributed Hono deployments require both the platform `waitUntil` and a durable delivery store.

### Next route handler

Next and other restartable serverless hosts must provide their platform background scheduler and a shared durable `DeliveryStore`:

```ts
const agent = createAgent({
  token: process.env.AGENT_TOKEN!,
  webhookSecret: process.env.WEBHOOK_SECRET!,
  deliveryStore,
});

export const POST = agent.adapters.next(waitUntil);
```

### Cloudflare Worker

```ts
export default { fetch: agent.adapters.cloudflare };
```

## Delivery safety

The SDK verifies HMAC-SHA256 over `timestamp.rawBody`, rejects timestamps outside five minutes, compares signatures in constant time, limits request bodies, and requires event and delivery headers to match their signed body fields. Before acknowledging a run event, it reads that run with the configured token and verifies the agent/task binding.

The built-in `MemoryDeliveryStore` is deliberately single-process only. It has expiring owner-fenced claims and bounded retention, which is suitable for plain Node and local development. Next, Cloudflare, and other distributed adapters fail with 503 unless `deliveryStore.durable === true`. A durable implementation must make `claim`, `renew`, `complete`, and `release` atomic, reject expired or stale owners, and honor the supplied expiry values.

`waitUntil` keeps accepted work alive but is not a durable job queue. If the hosting platform needs crash-proof execution, its adapter should enqueue the verified delivery before returning 2xx and invoke the SDK worker from that queue.

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
