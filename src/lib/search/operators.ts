import prisma from '@/lib/prisma'

export const SEARCH_OPERATORS = ['from', 'assignee', 'in', 'board', 'label', 'is', 'before', 'after', 'on', 'has'] as const
export type SearchOperator = (typeof SEARCH_OPERATORS)[number]
export type SearchFilter = { value: string; negated: boolean }
export type ParsedSearch = { text: string; filters: Partial<Record<SearchOperator, SearchFilter[]>> }
type NameOperator = 'from' | 'assignee' | 'in' | 'board' | 'label'
type Names = Partial<Record<NameOperator, string[]>>
export const MAX_SEARCH_OPERATOR_CLAUSES = 12

function operatorMatches(raw: string) {
  const matches: { start: number; valueStart: number; operator: string; negated: boolean }[] = []
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"' && raw[i - 1] !== '\\') quoted = !quoted
    if (quoted || (i > 0 && !/\s/.test(raw[i - 1]))) continue
    const match = raw.slice(i).match(/^(-?)([a-z]+):/i)
    if (match) {
      matches.push({ start: i, valueStart: i + match[0].length, operator: match[2].toLowerCase(), negated: match[1] === '-' })
      i += match[0].length - 1
    }
  }
  return matches
}

export function searchOperatorClauseCount(raw: string) {
  return operatorMatches(raw).length
}

export function parseSearchQuery(raw: string, names: Names = {}): ParsedSearch {
  const filters: ParsedSearch['filters'] = {}
  const remaining: string[] = []
  const operators = new Set<string>(SEARCH_OPERATORS)
  const matches = operatorMatches(raw)
  let position = 0
  for (let i = 0; i < matches.length; i++) {
    const { start, valueStart, operator, negated } = matches[i]
    const end = matches[i + 1]?.start ?? raw.length
    remaining.push(raw.slice(position, start))
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
      ;(filters[key] ??= []).push({ value, negated })
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
  const lookedUp = new Set<string>()
  for (const { operator, valueStart } of operatorMatches(raw).slice(0, MAX_SEARCH_OPERATOR_CLAUSES)) {
    if (!['from', 'assignee', 'in', 'board', 'label'].includes(operator)) continue
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
  return parseSearchQuery(raw, names)
}
