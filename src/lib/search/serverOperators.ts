import prisma from '@/lib/prisma'
import { MAX_SEARCH_OPERATOR_CLAUSES, operatorMatches, parseSearchQuery, type Names, type ParsedSearch } from './operators'

type NameOperator = 'from' | 'assignee' | 'in' | 'board' | 'label'

export async function parseSearchWithNames(raw: string, projectIds: number[]): Promise<ParsedSearch> {
  const names: Names = {}
  const lookedUp = new Set<string>()
  for (const { operator, valueStart } of operatorMatches(raw).slice(0, MAX_SEARCH_OPERATOR_CLAUSES)) {
    if (!['from', 'assignee', 'in', 'board', 'label'].includes(operator)) continue
    const token = raw.slice(valueStart).match(/^[@#]?[^\s"]+/)?.[0] ?? ''
    const prefix = token.replace(/^[@#]/, '')
    const key = `${operator}:${prefix.toLowerCase()}`
    if (!prefix || /^\d+$/.test(prefix) || lookedUp.has(key)) continue
    lookedUp.add(key)
    const nameOperator = operator as NameOperator
    if (nameOperator === 'in' || nameOperator === 'board') {
      names[nameOperator] = [...(names[nameOperator] ?? []), ...(await prisma.project.findMany({
        where: { id: { in: projectIds }, title: { startsWith: prefix, mode: 'insensitive' } },
        select: { title: true },
      })).map((row) => row.title ?? '')]
    } else if (operator === 'label') {
      names.label = [...(names.label ?? []), ...(await prisma.label.findMany({
        where: { projectId: { in: projectIds }, value: { startsWith: prefix, mode: 'insensitive' } },
        select: { value: true },
      })).map((row) => row.value ?? '')]
    } else {
      names[nameOperator] = [...(names[nameOperator] ?? []), ...(await prisma.user.findMany({
        where: { displayName: { startsWith: prefix, mode: 'insensitive' }, OR: [
          { tasks: { some: { projectId: { in: projectIds } } } },
          { assignees: { some: { task: { projectId: { in: projectIds } } } } },
          { members: { some: { projectId: { in: projectIds } } } },
        ] },
        select: { displayName: true },
      })).map((row) => row.displayName ?? '')]
    }
  }
  const parsed = parseSearchQuery(raw, names)
  for (const key of ['in', 'board'] as const) {
    for (const filter of parsed.filters[key] ?? []) filter.value = filter.value.replace(/^#/, '')
  }
  return parsed
}
