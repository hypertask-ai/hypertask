// Which model option a chat turn should run on, given what the request asked
// for and what the acting agent is pinned to.
//
// Pulled out of the chat route so it can be tested directly: the rule is small
// but it decides what the team is billed for, and inside a 10k-line route it
// was only ever covered by matching the source text.
// Model options an agent must never be pinned to. "custom" is not a model, it
// is "whatever endpoint you configured", and an agent has nowhere to configure
// one, so a turn on it fails while the agent still reads as pinned.
export const UNPINNABLE_MODEL_OPTION_IDS = new Set(["custom"]);

export function canPinModelOption(id: string): boolean {
  return !UNPINNABLE_MODEL_OPTION_IDS.has(id);
}

export type AgentModelPinInput = {
  // What the request named, if anything. An empty string is a form default,
  // not a choice, and must not out-rank the agent's pin.
  requestedModelOptionId?: string | null;
  requestedModel?: string | null;
  agentModelOptionId?: string | null;
};

export function resolveAgentModelPin({
  requestedModelOptionId,
  requestedModel,
  agentModelOptionId,
}: AgentModelPinInput): string | null {
  const requested = requestedModelOptionId?.trim() || null;
  if (requested) return requested;
  // Naming a raw model is just as explicit as naming an option, so the pin
  // steps aside for it too.
  if (requestedModel?.trim()) return null;
  return agentModelOptionId?.trim() || null;
}
