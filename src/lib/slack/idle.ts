export const SLACK_THREAD_IDLE_MS = 30 * 60 * 1000;

export type SlackThreadSummaryState = {
  lastMessageTs: string;
  lastSummarizedTs: string | null;
};

export function slackTsToMilliseconds(value: string): number {
  return Number.parseFloat(value) * 1000;
}

export function slackIdleCutoffTs(
  nowMs = Date.now(),
  idleMs = SLACK_THREAD_IDLE_MS,
): string {
  return ((nowMs - idleMs) / 1000).toFixed(6);
}

export function needsSlackThreadSummary(
  thread: SlackThreadSummaryState,
  nowMs = Date.now(),
  idleMs = SLACK_THREAD_IDLE_MS,
): boolean {
  const lastMessageMs = slackTsToMilliseconds(thread.lastMessageTs);
  if (!Number.isFinite(lastMessageMs) || lastMessageMs > nowMs - idleMs) {
    return false;
  }

  if (!thread.lastSummarizedTs) return true;

  const lastSummarizedMs = slackTsToMilliseconds(thread.lastSummarizedTs);
  return (
    Number.isFinite(lastSummarizedMs) && lastMessageMs > lastSummarizedMs
  );
}

export function latestSlackTs(current: string, candidate: string): string {
  const currentValue = Number.parseFloat(current);
  const candidateValue = Number.parseFloat(candidate);
  if (!Number.isFinite(candidateValue)) return current;
  if (!Number.isFinite(currentValue)) return candidate;
  return candidateValue > currentValue ? candidate : current;
}
