export const sessionStatuses = ['Active', 'Idle', 'Dead'] as const
export type SessionStatusValue = (typeof sessionStatuses)[number]

export function normalizeSessionStatus(
  value?: unknown
): SessionStatusValue | null {
  if (value === undefined || value === null) return 'Active'
  if (typeof value !== 'string') return null
  const match = sessionStatuses.find(
    (s) => s.toLowerCase() === value.trim().toLowerCase()
  )
  return match ?? null
}
