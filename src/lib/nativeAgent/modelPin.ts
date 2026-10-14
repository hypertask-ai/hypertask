export const UNPINNABLE_MODEL_OPTION_IDS = new Set(["custom"]);

export function canPinModelOption(id: string): boolean {
  return !UNPINNABLE_MODEL_OPTION_IDS.has(id);
}

export type AgentModelPinInput = {
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
  if (requestedModel?.trim()) return null;
  return agentModelOptionId?.trim() || null;
}
