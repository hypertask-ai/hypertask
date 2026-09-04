import { createAgent } from "../index.js";
import type { AgentOptions, AgentRun } from "../types.js";

export type ReplyOnlyOptions = AgentOptions & {
  reply(run: AgentRun): string | Promise<string>;
};

/** Mention/chat template that records one response and never changes a task. */
export function createReplyOnlyAssistant(options: ReplyOnlyOptions) {
  const agent = createAgent(options);
  const reply = async (run: AgentRun) => {
    await run.respond(await options.reply(run));
  };
  agent.on("mention", reply);
  agent.on("chat", reply);
  agent.on("prompted", reply);
  return agent;
}
