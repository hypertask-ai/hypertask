import type { AgentRuntimeHealth } from "@/lib/agents/runtimeState";

export type RuntimeStateKey = AgentRuntimeHealth | "on_demand";

// A native agent has no background worker reporting a heartbeat: it runs when
// someone messages it. Without a live report it is "on demand", not "offline",
// or its page says Running in the header and Offline below (HTPR-6836).
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
