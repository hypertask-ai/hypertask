export const SEARCH_OPERATORS = ['from', 'commenter', 'assignee', 'in', 'board', 'label', 'is', 'before', 'after', 'on', 'has'] as const
export type SearchOperator = (typeof SEARCH_OPERATORS)[number]
export type SearchFilter = { value: string; negated: boolean; userIds?: number[] }
// HTPR-6368: logic-only operators. Kept out of SEARCH_OPERATORS so no suggestion, tip or chip appears for them.
export const LOGIC_OPERATORS = ['type', 'priority'] as const
export type LogicOperator = (typeof LOGIC_OPERATORS)[number]
// 'phrase' holds exact phrases ("a b") and exclusions (-word, -"a b"; negated: true) found in the plain text.
export type SearchFilterKey = SearchOperator | LogicOperator | 'phrase'
export type ParsedSearch = { text: string; filters: Partial<Record<SearchFilterKey, SearchFilter[]>> }
export type NameOperator = 'from' | 'commenter' | 'assignee' | 'in' | 'board' | 'label'
type Names = Partial<Record<NameOperator, string[]>>
export type { Names }
export type SearchToken = { operator: SearchOperator; value: string; negated: boolean; raw: string; start: number; end: number }
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

const TEXT_CLAUSE = /(^|\s)(-?)"([^"]+)"(?=\s|$)|(^|\s)-([\p{L}\p{N}][^\s:"]*)(?=\s|$)/gu

// Pulls "exact phrases" and -word / -"phrase" exclusions out of plain text. Positive phrases stay in the
// text without quotes so ranking still sees their words; the clause enforces the exact phrase.
export function extractTextClauses(text: string) {
  const clauses: SearchFilter[] = []
  const rest = text.replace(TEXT_CLAUSE, (_all, lead1?: string, dash?: string, phrase?: string, lead2?: string, word?: string) => {
    if (phrase !== undefined) {
      const value = phrase.trim()
      if (!value) return `${lead1}${dash}"${phrase}"`
      clauses.push({ value, negated: dash === '-' })
      return dash === '-' ? (lead1 ?? '') : `${lead1}${value}`
    }
    clauses.push({ value: word ?? '', negated: true })
    return lead2 ?? ''
  })
  return { text: rest.replace(/\s+/g, ' ').trim(), clauses }
}

export function parseSearchQuery(raw: string, names: Names = {}, commenterEnabled = false, logicEnabled = false): ParsedSearch {
  const filters: ParsedSearch['filters'] = {}
  const remaining: string[] = []
  const operators = new Set<string>([
    ...SEARCH_OPERATORS.filter((operator) => operator !== 'commenter' || commenterEnabled),
    ...(logicEnabled ? LOGIC_OPERATORS : []),
  ])
  const matches = operatorMatches(raw)
  let position = 0
  for (let i = 0; i < matches.length; i++) {
    const { start, valueStart, operator, negated } = matches[i]
    const end = matches[i + 1]?.start ?? raw.length
    remaining.push(raw.slice(position, start))
    const rawValue = raw.slice(valueStart, end).trim()
    const quoted = rawValue.match(/^"([^"]+)"(?:\s+|$)/)
    let value = quoted ? quoted[1] : rawValue.match(/^\S+/)?.[0] ?? ''
    if (!quoted && value.startsWith('#') && (operator === 'in' || operator === 'board') && names[operator]) {
      const matchName = names[operator]?.filter((name) => rawValue.slice(1).toLowerCase().startsWith(name.toLowerCase()) &&
        (rawValue.length - 1 === name.length || /\s/.test(rawValue[name.length + 1] ?? '')))
        .sort((a, b) => b.length - a.length)[0]
      if (matchName) value = `#${matchName}`
    }
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
      const key = operator as SearchFilterKey
      ;(filters[key] ??= []).push({ value, negated })
      remaining.push(rawValue.slice(quoted ? quoted[0].length : value.length))
    } else {
      remaining.push(raw.slice(start, end))
    }
    position = end
  }
  remaining.push(raw.slice(position))
  const text = remaining.join(' ').replace(/\s+/g, ' ').trim()
  if (!logicEnabled) return { text, filters }
  const extracted = extractTextClauses(text)
  if (extracted.clauses.length) filters.phrase = extracted.clauses
  return { text: extracted.text, filters }
}

export { operatorMatches }

export function parseSearchTokens(raw: string, names: Names = {}, commenterEnabled = false): SearchToken[] {
  const parsed = parseSearchQuery(raw, names, commenterEnabled)
  const used: Partial<Record<SearchOperator, number>> = {}
  const matches = operatorMatches(raw)
  return matches.flatMap(({ start, valueStart, operator, negated }, index) => {
    if (!SEARCH_OPERATORS.includes(operator as SearchOperator)) return []
    const key = operator as SearchOperator
    const rawValue = raw.slice(valueStart, matches[index + 1]?.start ?? raw.length).trim()
    if (!rawValue) return []
    const value = parsed.filters[key]?.[used[key] ?? 0]?.value
    if (!value) return []
    used[key] = (used[key] ?? 0) + 1
    const offset = raw.slice(valueStart).match(/^\s*/)?.[0].length ?? 0
    const end = rawValue.startsWith('"') ? raw.indexOf('"', valueStart + offset + 1) + 1 : valueStart + offset + value.length
    return [{ operator: key, value, negated, raw: raw.slice(start, end), start, end }]
  })
}
