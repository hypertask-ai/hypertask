export type AgentStep = "working" | "in review" | "in QA" | "waiting for you" | "blocked";

/** HTPR-7071: the step is read from the card's column and labels, never fetched. */
export function agentStepFor(sectionTitle: string | null | undefined, labelValues: readonly string[] = []): AgentStep {
  const title = (sectionTitle ?? "").trim().toLowerCase();
  if (title === "blocked" || labelValues.some((value) => value.trim().toLowerCase() === "blocked")) return "blocked";
  if (title === "valentin review") return "waiting for you";
  if (title === "qa") return "in QA";
  if (title === "ai review") return "in review";
  return "working";
}

/** Matches the board's 6 hour claim staleness rule: older runs say nothing useful. */
export const AGENT_STATUS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** True while the last report is under six hours old; `minute` is the shared minute clock value. */
export function agentStatusIsFresh(iso: string, minute: number = Math.floor(Date.now() / 60_000)): boolean {
  return minute * 60_000 - new Date(iso).getTime() < AGENT_STATUS_MAX_AGE_MS;
}

export function agentStatusAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export function agentStatusText(agentName: string, step: AgentStep, iso: string, now?: number): string {
  return `${agentName}: ${step}, ${agentStatusAgo(iso, now)}`;
}
