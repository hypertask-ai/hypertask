import type { AgentRuntimeHealth } from "@/lib/agents/runtimeState";

export type RuntimeStateKey = AgentRuntimeHealth | "on_demand";

export function runtimeStateKey(agent: {
  runtimeType: "NATIVE" | "EXTERNAL";
  revokedAt: string | null;
  operations: { source: "runtime" | "inferred"; health: AgentRuntimeHealth };
}): RuntimeStateKey {
  if (
    agent.runtimeType === "NATIVE" &&
    !agent.revokedAt &&
    agent.operations.source !== "runtime"
  ) {
    return "on_demand";
  }
  return agent.operations.health;
}
