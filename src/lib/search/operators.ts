import prisma from '@/lib/prisma'

export const SEARCH_OPERATORS = ['from', 'assignee', 'in', 'board', 'label', 'is', 'before', 'after', 'on', 'has'] as const
export type SearchOperator = (typeof SEARCH_OPERATORS)[number]
export type SearchFilter = { value: string; negated: boolean }
export type ParsedSearch = { text: string; filters: Partial<Record<SearchOperator, SearchFilter[]>> }
type NameOperator = 'from' | 'assignee' | 'in' | 'board' | 'label'
type Names = Partial<Record<NameOperator, string[]>>

export function parseSearchQuery(raw: string, names: Names = {}): ParsedSearch {
  const filters: ParsedSearch['filters'] = {}
  const remaining: string[] = []
  const operators = new Set<string>(SEARCH_OPERATORS)
  const boundary = /(?:^|\s)(-?)([a-z]+):/gi
  const matches = [...raw.matchAll(boundary)]
  let position = 0
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = match.index! + (match[0].match(/^\s/) ? 1 : 0)
    const valueStart = match.index! + match[0].length
    const end = i + 1 < matches.length
      ? matches[i + 1].index! + (matches[i + 1][0].match(/^\s/) ? 1 : 0)
      : raw.length
    remaining.push(raw.slice(position, start))
    const operator = match[2].toLowerCase()
    const rawValue = raw.slice(valueStart, end).trim()
    const quoted = rawValue.match(/^"([^"]+)"(?:\s+|$)/)
    let value = quoted ? quoted[1] : rawValue.match(/^\S+/)?.[0] ?? ''
    if (!quoted && operator in names) {
      const prefix = value.replace(/^@/, '')
      const matchName = names[operator as NameOperator]?.filter((name) =>
        name.toLowerCase().startsWith(prefix.toLowerCase()) &&
        rawValue.replace(/^@/, '').toLowerCase().startsWith(name.toLowerCase()) &&
        (rawValue.length - Number(rawValue.startsWith('@')) === name.length ||
          /\s/.test(rawValue[name.length + Number(rawValue.startsWith('@'))] ?? ''))
      ).sort((a, b) => b.length - a.length)[0]
      if (matchName) value = `${value.startsWith('@') ? '@' : ''}${matchName}`
    }
    if (operators.has(operator) && value) {
      const key = operator as SearchOperator
      ;(filters[key] ??= []).push({ value, negated: match[1] === '-' })
      remaining.push(rawValue.slice(quoted ? quoted[0].length : value.length))
    } else {
      remaining.push(raw.slice(start, end))
    }
    position = end
  }
  remaining.push(raw.slice(position))
  return { text: remaining.join(' ').replace(/\s+/g, ' ').trim(), filters }
}

export async function parseSearchWithNames(raw: string, projectIds: number[]): Promise<ParsedSearch> {
  const names: Names = {}
  const prefixes = [...raw.matchAll(/(?:^|\s)-?(from|assignee|in|board|label):(@?[^\s"]+)/gi)]
  for (const [, key, token] of prefixes) {
    const operator = key.toLowerCase() as NameOperator
    const prefix = token.replace(/^@/, '')
    if (!prefix || /^\d+$/.test(prefix)) continue
    if (operator === 'in' || operator === 'board') {
      names[operator] = [...(names[operator] ?? []), ...(await prisma.project.findMany({
        where: { id: { in: projectIds }, title: { startsWith: prefix, mode: 'insensitive' } },
        select: { title: true },
      })).map((row) => row.title ?? '')]
    } else if (operator === 'label') {
      names.label = [...(names.label ?? []), ...(await prisma.label.findMany({
        where: { projectId: { in: projectIds }, value: { startsWith: prefix, mode: 'insensitive' } },
        select: { value: true },
      })).map((row) => row.value ?? '')]
    } else {
      names[operator] = [...(names[operator] ?? []), ...(await prisma.user.findMany({
        where: { displayName: { startsWith: prefix, mode: 'insensitive' }, OR: [
          { tasks: { some: { projectId: { in: projectIds } } } },
          { assignees: { some: { task: { projectId: { in: projectIds } } } } },
          { members: { some: { projectId: { in: projectIds } } } },
        ] },
        select: { displayName: true },
      })).map((row) => row.displayName ?? '')]
    }
  }
  return parseSearchQuery(raw, names)
}
