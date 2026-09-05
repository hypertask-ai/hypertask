import {
  cloudflareWorkerAdapter,
  expressAdapter,
  honoAdapter,
  nextRouteAdapter,
  nodeHttpAdapter,
} from "./adapters.js";
import { createClient } from "./client.js";
import { createWebhookHandler } from "./webhook.js";
import type { AgentOptions, DeliveryScheduler } from "./types.js";

export * from "./adapters.js";
export * from "./client.js";
export * from "./types.js";
export * from "./webhook.js";

export function createAgent(options: AgentOptions) {
  // Construction is local-only; protected run APIs enforce the epic and HTPR-6123 flags server-side.
  const client = createClient(options);
  const handler = createWebhookHandler({
    client,
    webhookSecret: options.webhookSecret,
    deliveryStore: options.deliveryStore,
    scheduler: options.scheduler,
  });

  return {
    client,
    handler,
    processDelivery: handler.processDelivery,
    on: client.on.bind(client),
    adapters: {
      node: (adapterOptions?: Parameters<typeof nodeHttpAdapter>[1]) =>
        nodeHttpAdapter(handler, adapterOptions),
      express: (adapterOptions?: Parameters<typeof expressAdapter>[1]) =>
        expressAdapter(handler, adapterOptions),
      hono: (adapterOptions?: Parameters<typeof honoAdapter>[1]) =>
        honoAdapter(handler, adapterOptions),
      next: (scheduler: DeliveryScheduler) => nextRouteAdapter(handler, scheduler),
      cloudflare: (scheduler: DeliveryScheduler) =>
        cloudflareWorkerAdapter(handler, scheduler),
    },
  };
}
