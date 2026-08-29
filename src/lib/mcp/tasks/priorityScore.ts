const PRIORITY_SCORES: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function priorityScore(
  priority?: string | null,
  dueDate?: Date | null,
  now = new Date()
): number {
  let score = PRIORITY_SCORES[priority?.trim().toLowerCase() ?? ''] ?? 0

  if (!dueDate) return score

  const dueTime = dueDate.getTime()
  const nowTime = now.getTime()
  if (!Number.isFinite(dueTime) || !Number.isFinite(nowTime)) return score

  if (dueTime < nowTime) {
    score += 2
  } else if (dueTime <= nowTime + DAY_MS) {
    score += 1
  }

  return score
}
