export const SEARCH_OPERATORS = ['from', 'assignee', 'in', 'board', 'label', 'is', 'before', 'after', 'on', 'has'] as const
export type SearchOperator = (typeof SEARCH_OPERATORS)[number]
export type SearchFilter = { value: string; negated: boolean }
export type ParsedSearch = { text: string; filters: Partial<Record<SearchOperator, SearchFilter[]>> }
type NameOperator = 'from' | 'assignee' | 'in' | 'board' | 'label'
export type Names = Partial<Record<NameOperator, string[]>>
export type SearchToken = { operator: SearchOperator; value: string; negated: boolean; raw: string; start: number; end: number }
export const MAX_SEARCH_OPERATOR_CLAUSES = 12

export function operatorMatches(raw: string) {
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

export function parseSearchQuery(raw: string, names: Names = {}, tokens?: SearchToken[]): ParsedSearch {
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
      const marker = value.match(/^[@#]/)?.[0] ?? ''
      const prefix = value.slice(marker.length)
      const matchName = names[operator as NameOperator]?.filter((name) =>
        name.toLowerCase().startsWith(prefix.toLowerCase()) &&
        rawValue.slice(marker.length).toLowerCase().startsWith(name.toLowerCase()) &&
        (rawValue.length - marker.length === name.length ||
          /\s/.test(rawValue[name.length + marker.length] ?? ''))
      ).sort((a, b) => b.length - a.length)[0]
      if (matchName) value = `${marker}${matchName}`
    }
    if (operators.has(operator) && value) {
      const key = operator as SearchOperator
      ;(filters[key] ??= []).push({ value, negated })
      const valueOffset = raw.slice(valueStart, end).match(/^\s*/)?.[0].length ?? 0
      const tokenEnd = quoted ? raw.indexOf('"', valueStart + valueOffset + 1) + 1 : valueStart + valueOffset + value.length
      tokens?.push({ operator: key, value, negated, raw: raw.slice(start, tokenEnd), start, end: tokenEnd })
      remaining.push(rawValue.slice(quoted ? quoted[0].length : value.length))
    } else {
      remaining.push(raw.slice(start, end))
    }
    position = end
  }
  remaining.push(raw.slice(position))
  return { text: remaining.join(' ').replace(/\s+/g, ' ').trim(), filters }
}
