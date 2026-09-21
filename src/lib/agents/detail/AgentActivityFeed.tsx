import type { TAgent } from "@/app/agents/AgentsRegister";
import type { AgentRuntimeHealth } from "@/lib/agents/runtimeState";

export const PROMPT_MAX = 8000;

export const PROMPT_WARN = 7000;

export function elapsedSince(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const healthLabel: Record<AgentRuntimeHealth, string> = {
  working: "Working",
  connected: "Connected",
  waiting: "Waiting",
  stalled: "Stalled",
  offline: "Offline",
};

export const healthDotClass: Record<AgentRuntimeHealth, string> = {
  working: "bg-hypertasks-green",
  connected: "bg-hypertasks-green",
  waiting: "bg-amber-400",
  stalled: "bg-red-400",
  offline: "bg-gray-500",
};

export const queueReasonLabel = {
  direct_mention: "Direct mention",
  assignment: "Assigned",
  discovery: "Discovery candidate",
  other: "Queued",
} as const;

export function statusWord(agent: TAgent): string {
  if (agent.revokedAt) return "Off";
  const last = [agent.heartbeatAt, agent.lastPostedAt].filter(
    (t): t is string => Boolean(t),
  );
  const latest =
    last.length > 0 ? last.reduce((a, b) => (b > a ? b : a)) : null;
  if (latest && Date.now() - new Date(latest).getTime() < 24 * 60 * 60 * 1000) {
    return "Running";
  }
  return "Quiet";
}

export const statusDotClass: Record<string, string> = {
  Running: "bg-green-500",
  Quiet: "bg-gray-400",
  Off: "bg-gray-500 opacity-50",
};
