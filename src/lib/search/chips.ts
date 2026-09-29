import { parseSearchTokens, type Names, type SearchToken } from './browserOperators'

export function splitSearchChips(raw: string, editing = false, names: Names = {}) {
  const tokens = parseSearchTokens(raw, names)
  const chips = editing ? tokens.filter((token) => {
    if (token.raw.includes('"')) return true
    const namesForOperator = names[token.operator as keyof Names]
    if (['from', 'assignee', 'in', 'board', 'label'].includes(token.operator)) {
      const value = token.value.replace(/^[@#]/, '').toLowerCase()
      if (/^\d+$/.test(token.value) && namesForOperator?.includes(token.value)) return true
      if (!namesForOperator?.some((name) => name.toLowerCase() === value) ||
        namesForOperator.some((name) => name.length > value.length && name.toLowerCase().startsWith(value))) return false
      return true
    }
    if (token.end < raw.length || /\s$/.test(raw)) return true
    if (token.operator === 'is') return ['open', 'done', 'archived'].includes(token.value.toLowerCase())
    if (token.operator === 'has') return ['attachment', 'comment', 'due', 'due-date'].includes(token.value.toLowerCase())
    if (['before', 'after', 'on'].includes(token.operator)) return /\d{4}-\d{2}-\d{2}$/.test(token.value)
    return namesForOperator?.some((name) => token.value.replace(/^[@#]/, '').toLowerCase() === name.toLowerCase()) ?? false
  }) : tokens
  let cursor = 0
  const text: string[] = []
  for (const chip of chips) {
    text.push(raw.slice(cursor, chip.start))
    cursor = chip.end
  }
  text.push(raw.slice(cursor))
  const draft = text.join(' ').replace(/\s+/g, ' ').trim()
  return { chips, text: editing && /\s$/.test(raw) ? `${draft} ` : draft }
}

export function chipQuery(chips: SearchToken[], text: string) {
  return [...chips.map((chip) => chip.raw), text].filter(Boolean).join(' ').trim()
}

export function candidateQuery(operator: string, name: string, id?: number | string) {
  if (id !== undefined) return `${operator}:${id}`
  const value = `${operator === 'from' || operator === 'assignee' ? '@' : operator === 'in' ? '#' : ''}${name}`
  return `${operator}:${/\s|"/.test(value) ? JSON.stringify(value) : value}`
}

export function activeSearchValue(text: string, names: Names = {}): { operator: string; value: string; start: number; end?: number; negated?: boolean } | null {
  if (/\s$/.test(text)) return null
  const tokens = parseSearchTokens(text)
  const last = tokens.at(-1)
  if (last && ['from', 'assignee', 'in', 'board', 'label'].includes(last.operator)) {
    const valueStart = last.start + last.raw.indexOf(':') + 1
    const marker = /^[@#]/.test(text.slice(valueStart)) ? 1 : 0
    const tail = text.slice(valueStart + marker)
    const knownPrefix = names[last.operator as keyof Names]?.some((name) =>
      name.toLowerCase().startsWith(tail.toLowerCase()))
    const value = knownPrefix ? tail : tail.match(/^\S+/)?.[0] ?? ''
    return { operator: last.operator, value, start: last.start, end: valueStart + marker + value.length, ...(last.negated ? { negated: true } : {}) }
  }
  const trigger = text.match(/(?:^|\s)([@#])([^\s]*)$/)
  if (trigger) return { operator: trigger[1] === '@' ? 'from' : 'in', value: trigger[2], start: text.length - trigger[0].trimStart().length }
  const empty = text.match(/(?:^|\s)(from|assignee|in|board|label):$/i)
  return empty ? { operator: empty[1].toLowerCase(), value: '', start: text.length - empty[0].trimStart().length } : null
}
