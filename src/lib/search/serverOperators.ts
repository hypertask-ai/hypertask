import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { MAX_SEARCH_OPERATOR_CLAUSES, operatorMatches, parseSearchQuery, type NameOperator, type Names, type ParsedSearch } from './operators'

export async function parseSearchWithNames(raw: string, projectIds: number[], fuzzyPersonEnabled = false, personProjectIds = projectIds, commenterEnabled = false): Promise<ParsedSearch> {
  const names: Names = {}
  const lookedUp = new Set<string>()
  for (const { operator, valueStart } of operatorMatches(raw).slice(0, MAX_SEARCH_OPERATOR_CLAUSES)) {
    if (!['from', 'assignee', 'in', 'board', 'label', ...(commenterEnabled ? ['commenter'] : [])].includes(operator)) continue
    const token = raw.slice(valueStart).match(/^@?[^\s"]+/)?.[0] ?? ''
    const prefix = token.replace(/^@/, '')
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
      const scope = operator === 'commenter' ? personProjectIds : projectIds
      names[nameOperator] = [...(names[nameOperator] ?? []), ...(await prisma.user.findMany({
        where: { displayName: { startsWith: prefix, mode: 'insensitive' }, OR: [
          { tasks: { some: { projectId: { in: scope } } } },
          { assignees: { some: { task: { projectId: { in: scope } } } } },
          { members: { some: { projectId: { in: scope } } } },
          ...(operator === 'commenter' ? [{ comments: { some: { activity: { equals: Prisma.DbNull }, task: { projectId: { in: personProjectIds }, status: { in: ['Normal' as const, 'Archive' as const] } } } } }] : []),
        ] },
        select: { displayName: true },
        ...(operator === 'commenter' ? { take: 1000, orderBy: { id: 'asc' as const } } : {}),
      })).map((row) => row.displayName ?? '')]
    }
  }
  const parsed = parseSearchQuery(raw, names, commenterEnabled)
  if (fuzzyPersonEnabled) {
    for (const [clauses, isCommenter] of [
      [[...(parsed.filters.from ?? []), ...(parsed.filters.assignee ?? [])], false],
      [parsed.filters.commenter ?? [], true],
    ] as const) {
      const filters = clauses.filter(({ value }) => !/^\d+$/.test(value.replace(/^@/, '').trim()))
      if (!filters.length) continue
      const people = await prisma.user.findMany({
        where: { OR: [
          { tasks: { some: { projectId: { in: personProjectIds } } } },
          { assignees: { some: { task: { projectId: { in: personProjectIds } } } } },
          { members: { some: { projectId: { in: personProjectIds } } } },
          ...(isCommenter ? [{ comments: { some: { activity: { equals: Prisma.DbNull }, task: { projectId: { in: personProjectIds }, status: { in: ['Normal' as const, 'Archive' as const] } } } } }] : []),
        ] },
        select: { id: true, displayName: true, email: true },
        ...(isCommenter ? { take: 1000, orderBy: { id: 'asc' as const } } : {}),
      })
      const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      for (const filter of filters) {
        const value = normalize(filter.value.replace(/^@/, '').trim())
        filter.userIds = value ? people.filter((person) =>
          normalize(person.displayName ?? '').includes(value) || normalize(person.email).includes(value)
        ).map((person) => person.id) : []
      }
    }
  }
  return parsed
}

export async function parseSearchWithChipNames(raw: string, projectIds: number[], fuzzyPersonEnabled = false, personProjectIds = projectIds, commenterEnabled = false) {
  const normalized = raw.replace(/(^|\s)(-?(?:in|board):)#(?=\S)/gi, '$1$2')
  const parsed = await parseSearchWithNames(normalized, projectIds, fuzzyPersonEnabled, personProjectIds, commenterEnabled)
  for (const key of ['in', 'board'] as const) {
    for (const filter of parsed.filters[key] ?? []) filter.value = filter.value.replace(/^#/, '')
  }
  return parsed
}
