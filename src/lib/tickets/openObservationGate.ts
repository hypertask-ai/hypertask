import { parse } from 'node-html-parser'

const OPEN_WORDS = '\\b(?:unfinished|still open|not finished|not done|incomplete|remains open)\\b'
const NEGATED_OPEN = /(?:\bno longer|\bnot|\bnever)\s+$/i
const OBSERVATION_ITEM = /\bobservation\b/i
const GATE_LABEL = /^(?:[-*•]\s*)?(?:the\s+|this\s+|our\s+)?(?:full[- ]day\s+)?observation(?:\s+gate)?\b/i
const STATUS_END = /[.;,]/

function normalised(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function statesOpenStatus(clause: string, offset: number, line: string): boolean {
  for (const word of clause.matchAll(new RegExp(OPEN_WORDS, 'gi'))) {
    if (!NEGATED_OPEN.test(line.slice(0, offset + (word.index ?? 0)))) return true
  }
  return false
}

function lineStatesOpenObservation(line: string): boolean {
  const label = line.match(GATE_LABEL)
  if (!label) return false
  const rest = line.slice(label[0].length)
  const end = rest.search(STATUS_END)
  const clause = end === -1 ? rest : rest.slice(0, end)
  return statesOpenStatus(clause, label[0].length, line)
}

function plainLines(html: string): string[] {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|h[1-6]|tr|section|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .split('\n')
    .map(normalised)
}

function uncheckedObservationItems(html: string): string[] {
  if (!/data-checked/i.test(html)) return []
  return parse(html)
    .querySelectorAll('li')
    .filter((item) => item.getAttribute('data-checked') !== 'true')
    .map((item) => normalised(item.textContent ?? ''))
    .filter((text) => OBSERVATION_ITEM.test(text))
}

export function openObservationGates(...sources: Array<string | null | undefined>): string[] {
  const gates: string[] = []
  for (const source of sources) {
    if (!source) continue
    const found = [...uncheckedObservationItems(source), ...plainLines(source).filter(lineStatesOpenObservation)]
    for (const gate of found) {
      if (gate && !gates.includes(gate)) gates.push(gate)
    }
  }
  return gates
}

export function openObservationGateMessage(gates: string[]): string {
  return `Cannot mark this ticket done. The full-day observation gate is still unfinished: ${gates
    .map((gate) => `"${gate}"`)
    .join('; ')}.`
}
