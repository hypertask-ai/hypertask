export type BoardRunningTimer = {
  startedAt: string;
  pausedAt: string | null;
};

export type BoardTimeTotal = {
  calculatedAt: string;
  runningTimers: BoardRunningTimer[];
  totalSeconds: number;
};

export function legacyBoardTimeTotal(
  timer: BoardRunningTimer,
  calculatedAt = new Date(),
): BoardTimeTotal {
  const calculatedAtMs = calculatedAt.getTime();
  const startedAtMs = new Date(timer.startedAt).getTime();
  const pausedAtMs = timer.pausedAt
    ? new Date(timer.pausedAt).getTime()
    : calculatedAtMs;
  const totalSeconds =
    Number.isFinite(calculatedAtMs) &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(pausedAtMs)
      ? Math.max(0, Math.floor((pausedAtMs - startedAtMs) / 1000))
      : 0;

  return {
    calculatedAt: Number.isFinite(calculatedAtMs)
      ? calculatedAt.toISOString()
      : new Date(0).toISOString(),
    runningTimers: [timer],
    totalSeconds,
  };
}

export function displayedBoardTimeSeconds(
  total: BoardTimeTotal | undefined,
  nowMs: number,
): number {
  if (!total) return 0;

  const calculatedAtMs = new Date(total.calculatedAt).getTime();
  if (!Number.isFinite(calculatedAtMs)) return Math.max(0, total.totalSeconds);

  const liveSeconds = total.runningTimers.reduce((seconds, timer) => {
    if (timer.pausedAt !== null) return seconds;
    const startedAtMs = new Date(timer.startedAt).getTime();
    const liveStartMs = Number.isFinite(startedAtMs)
      ? Math.max(calculatedAtMs, startedAtMs)
      : calculatedAtMs;
    return seconds + Math.max(0, Math.floor((nowMs - liveStartMs) / 1000));
  }, 0);

  return Math.max(0, total.totalSeconds + liveSeconds);
}
