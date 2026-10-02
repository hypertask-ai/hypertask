import { PriorityConstants } from '@/lib/constants/constants'

// HTPR-6799: the CLI sends priority numbers (priority=1) while MCP callers send
// names (priority=Urgent). Both resolve to the stored priority_index.
const PRIORITY_ALIASES: Record<string, number> = { none: 0 }

export function parsePriorityFilter(values: string[]): number[] | null {
  const indexes: number[] = []
  for (const raw of values.flatMap((value) => value.split(','))) {
    const value = raw.trim().toLowerCase()
    if (!value) continue
    const byIndex = PriorityConstants.find((p) => String(p.priority_index) === value)
    const byName = PriorityConstants.find((p) => p.Priority_Value.toLowerCase() === value)
    const index = byIndex?.priority_index ?? byName?.priority_index ?? PRIORITY_ALIASES[value]
    if (index === undefined) return null
    indexes.push(index)
  }
  return indexes
}
