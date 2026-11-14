import { agentStatusIsFresh, agentStepFor, type AgentStep } from "@/lib/agentStatus/chip";

export const AGENT_STATUS_DOT_PULSE_MS = 10 * 60 * 1000;

export type AgentStatusDotMode = "working" | "waiting";

export function agentStatusDotMode(
  at: string,
  step: AgentStep,
  minute: number,
  now: number = minute * 60_000,
): AgentStatusDotMode | null {
  if (!agentStatusIsFresh(at, minute)) return null;
  if (step === "waiting for you") return "waiting";
  const ageMs = now - new Date(at).getTime();
  if (ageMs < AGENT_STATUS_DOT_PULSE_MS) return "working";
  return null;
}

export function agentStatusDotStep(
  sectionTitle: string | null | undefined,
  labelValues: readonly string[],
): AgentStep {
  return agentStepFor(sectionTitle, labelValues);
}
