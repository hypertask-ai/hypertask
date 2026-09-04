import {
  cloudflareWorkerAdapter,
  expressAdapter,
  honoAdapter,
  nextRouteAdapter,
  nodeHttpAdapter,
} from "./adapters.js";
import { createClient } from "./client.js";
import { createWebhookHandler } from "./webhook.js";
import type { AgentOptions } from "./types.js";

export * from "./adapters.js";
export * from "./client.js";
export * from "./types.js";
export * from "./webhook.js";

export function createAgent(options: AgentOptions) {
  const client = createClient(options);
  const handler = createWebhookHandler({
    client,
    webhookSecret: options.webhookSecret,
    deliveryStore: options.deliveryStore,
  });

  return {
    client,
    handler,
    on: client.on.bind(client),
    adapters: {
      node: nodeHttpAdapter(handler),
      express: expressAdapter(handler),
      hono: (adapterOptions?: Parameters<typeof honoAdapter>[1]) =>
        honoAdapter(handler, adapterOptions),
      next: (waitUntil: (task: Promise<void>) => void) =>
        nextRouteAdapter(handler, waitUntil),
      cloudflare: cloudflareWorkerAdapter(handler),
    },
  };
}
