export function skipAutomaticAiForAgentChange(agentId: string | null | undefined, flagEnabled: boolean) {
  return flagEnabled && typeof agentId === "string" && agentId.length > 0;
}
