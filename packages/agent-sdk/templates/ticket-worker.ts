import { createAgent } from "../index.js";
import type { AgentOptions, AgentRun, AgentTask } from "../types.js";

export type TicketWorkerOptions = AgentOptions & {
  work(ticket: AgentTask, run: AgentRun): void | Promise<void>;
};

/** Assigned-ticket template with visible progress and safe task helpers. */
export function createTicketWorker(options: TicketWorkerOptions) {
  const agent = createAgent(options);
  agent.on("assigned", async (run) => {
    if (!run.ticket) throw new Error("Assigned run has no ticket");
    await run.thought(`Starting ${run.ticket.ticketNumber ?? run.ticket.id}.`);
    await options.work(run.ticket, run);
  });
  return agent;
}
