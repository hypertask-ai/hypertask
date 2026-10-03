import { activeSearchValue } from './chips'
import { operatorMatches, parseSearchQuery, SEARCH_OPERATORS, type Names, type SearchOperator } from './operators'

export type SearchCandidate = { id: number | string; name: string; email?: string }
export const SEARCH_TIPS: Record<SearchOperator, { example: string; meaning: string }> = {
  from: { example: 'from:@Kamil', meaning: 'Created by this person' },
  assignee: { example: 'assignee:@Kamil', meaning: 'Assigned to this person' },
  in: { example: 'in:"Product Board"', meaning: 'In this board' },
  board: { example: 'board:"Product Board"', meaning: 'In this board (same as in:)' },
  label: { example: 'label:Bug', meaning: 'Has this label' },
  is: { example: 'is:done', meaning: 'Open, done or archived tasks' },
  has: { example: 'has:attachment', meaning: 'Has an attachment, comment or due date' },
  after: { example: 'after:2026-09-01', meaning: 'Created after this date (exclusive)' },
  before: { example: 'before:2026-10-01', meaning: 'Created before this date (exclusive)' },
  on: { example: 'on:2026-10-01', meaning: 'Created on this date (UTC)' },
}

export const SEARCH_FILTER_COLOURS = {
  people: 'bg-search-filter-people border-search-filter-people',
  board: 'bg-search-filter-board border-search-filter-board',
  label: 'bg-search-filter-label border-search-filter-label',
  status: 'bg-search-filter-status border-search-filter-status',
  date: 'bg-search-filter-date border-search-filter-date',
  has: 'bg-search-filter-has border-search-filter-has',
} as const

export function searchFilterType(operator: SearchOperator): keyof typeof SEARCH_FILTER_COLOURS {
  if (operator === 'from' || operator === 'assignee') return 'people'
  if (operator === 'in' || operator === 'board') return 'board'
  if (operator === 'before' || operator === 'after' || operator === 'on') return 'date'
  return operator === 'is' ? 'status' : operator
}

export function searchFilterColour(operator: SearchOperator) {
  return SEARCH_FILTER_COLOURS[searchFilterType(operator)]
}

export function operatorSuggestions(prefix: string) {
  return prefix ? SEARCH_OPERATORS.filter((operator) => operator.startsWith(prefix.toLowerCase())) : []
}

export type SearchCompletion = { kind: 'operator' | 'value'; operator: SearchOperator; value: string; start: number; end: number; negated?: boolean }
export function searchCompletion(text: string, names: Names = {}): SearchCompletion | null {
  const matches = operatorMatches(text)
  const last = matches.at(-1)
  if (/\s$/.test(text) && (!last || !/^"[^"]*$/.test(text.slice(last.valueStart)))) return null
  if (last && SEARCH_OPERATORS.includes(last.operator as SearchOperator)) {
    const tail = text.slice(last.valueStart)
    if (!/\s/.test(tail) || tail.startsWith('"')) {
      return { kind: 'value', operator: last.operator as SearchOperator, value: tail.replace(/^[@#"]/, '').replace(/"$/, ''), start: last.start, end: text.length, negated: last.negated }
    }
  }
  const active = activeSearchValue(text, names)
  if (active) return { ...active, kind: 'value', operator: active.operator as SearchOperator, end: active.end ?? text.length }
  // Do not offer operators inside quoted text or a value already being typed.
  if ((text.match(/(?<!\\)"/g)?.length ?? 0) % 2) return null
  const prefix = text.match(/(?:^|\s)(-?)([a-z]+)$/i)
  const operators = operatorSuggestions(prefix?.[2] ?? '')
  return prefix && operators.length ? { kind: 'operator', operator: operators[0], value: prefix[2], start: text.length - prefix[1].length - prefix[2].length, end: text.length, negated: prefix[1] === '-' } : null
}

export function localValueSuggestions(operator: SearchOperator, prefix = '', now = new Date()): SearchCandidate[] | null {
  let values: SearchCandidate[]
  if (operator === 'is' || operator === 'has') {
    values = (operator === 'is' ? ['open', 'done', 'archived'] : ['attachment', 'comment', 'due', 'due-date']).map((value) => ({ id: value, name: value }))
  } else if (['after', 'before', 'on'].includes(operator)) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const date = (offset: number) => new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10)
    values = [
      { id: date(0), name: `Today — ${date(0)}` },
      { id: date(-1), name: `Yesterday — ${date(-1)}` },
      { id: date(-7), name: `Last 7 days — ${date(-7)}` },
      { id: date(-((day.getUTCDay() + 6) % 7)), name: `This week — ${date(-((day.getUTCDay() + 6) % 7))}` },
    ]
    const typed = prefix.match(/^(?:(created|updated):)?(\d{4}-\d{2}-\d{2})$/i)
    if (typed) {
      const parsed = new Date(`${typed[2]}T00:00:00Z`)
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === typed[2]) {
        return [{ id: prefix.toLowerCase(), name: prefix.toLowerCase() }]
      }
    }
  } else return null
  return values.filter(({ id, name }) => name.toLowerCase().startsWith(prefix.toLowerCase()) || String(id).startsWith(prefix))
}

export function highlightedSearchSnippet(text: string, query: string) {
  const parts = highlightedTitle(text, query)
  const firstMatch = parts.findIndex((part) => part.matched)
  if (firstMatch < 0) return highlightedTitle(text.slice(0, 220), query)
  const offset = parts.slice(0, firstMatch).reduce((length, part) => length + part.text.length, 0)
  const start = Math.max(0, offset - 60)
  const end = Math.min(text.length, offset + 160)
  return highlightedTitle(`${start ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`, query)
}

export function highlightedTitle(title: string, query: string) {
  const terms = parseSearchQuery(query).text.split(/\s+/).filter(Boolean)
  if (!terms.length) return [{ text: title, matched: false }]
  const pattern = new RegExp(`(${terms.sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return title.split(pattern).filter(Boolean).map((text) => ({ text, matched: terms.some((term) => term.toLowerCase() === text.toLowerCase()) }))
}
