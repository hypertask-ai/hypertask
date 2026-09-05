import { createClient, type AgentClient } from "../client.js";
import type { AgentClientOptions } from "../types.js";

export type ScheduledBotOptions = AgentClientOptions & {
  tick(client: AgentClient): void | Promise<void>;
};

/** Cron template: call run() from the scheduler; no webhook secret is needed. */
export function createScheduledBot(options: ScheduledBotOptions) {
  const client = createClient(options);
  return {
    client,
    run: () => options.tick(client),
  };
}
