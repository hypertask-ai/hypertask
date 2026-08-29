export function hoursMinutesToMinutes(hours: string, minutes: string): number {
  const parsedHours = Number(hours || 0);
  const parsedMinutes = Number(minutes || 0);
  if (
    !Number.isInteger(parsedHours) ||
    parsedHours < 0 ||
    !Number.isInteger(parsedMinutes) ||
    parsedMinutes < 0 ||
    parsedMinutes > 59
  )
    return Number.NaN;
  return parsedHours * 60 + parsedMinutes;
}

export function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

// Pause arithmetic lives here, next to the other pure time helpers, so it can
// be unit-tested without booting the Prisma client (HTPR-4380).

/** Seconds counted so far. A paused timer freezes at pausedAt, a stopped one at endedAt. */
export function elapsedSeconds(
  startedAt: Date,
  endedAt: Date | null,
  pausedAt: Date | null,
  now = new Date()
) {
  return Math.max(
    0,
    Math.floor(((endedAt ?? pausedAt ?? now).getTime() - startedAt.getTime()) / 1000)
  );
}

/** Resume shifts startedAt forward by the paused gap, so the accumulated total carries over. */
export function resumedStartedAt(startedAt: Date, pausedAt: Date, now = new Date()) {
  return new Date(startedAt.getTime() + (now.getTime() - pausedAt.getTime()));
}

/** Stopping while paused bills up to the pause, never through it. */
export function stoppedAt(pausedAt: Date | null, now = new Date()) {
  return pausedAt ?? now;
}
