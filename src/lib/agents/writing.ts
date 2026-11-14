import { parse } from 'node-html-parser'
import { FLAG_CHAT_RECORD, normalizeVisibleText } from '@/lib/flags/approvalWords'
import { MAX_CHECK_TEXT_LENGTH, dropBlockquotes, stripTags } from '@/lib/text/safeHtmlText.mjs'

const ROBOT_STATUS = /(^|[\s.])(Next|Helpers|Branch\/PR|Branch|PR|Outputs|Claimed|Claim|Released|Resume|Session|tmux|Worktree|Ledger)\s*:/i
const BARE_GATE_LABEL = /^\s*(Gate|Gates)\s*:/i
const FEEDBACK_TALLY_LINE = /^(?:AI feedback tally|Fingerprint): ai-fb-[0-9a-f]{12}$/
const BUILD_ID = 'a build or commit id'
const TECHNICAL_KINDS: Array<[RegExp, string]> = [
  [/(^|\s)(~|\.{0,2})\/[\w.-]+\//, 'a file path'],
  [/\b[\w-]+\.(?:py|sh|zig|ts|tsx|js|mjs|go|kt|json|ya?ml|toml|md|jsonl|log|html)\b/, 'a file name'],
  [/\b[A-Za-z_][\w.]*\(\)/, 'a function call'],
  [/\b[a-z]+(?:_[a-z0-9]+)+\b/, 'a code name'],
  [/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b/, BUILD_ID],
  [/`[^`]+`/, 'a backticked value'],
  [/\b(?:Traceback|stderr|stdout|exit code|stack trace|tmux)\b/, 'a log word'],
  [/(?:^|\s)--[a-z][\w-]+/, 'a command flag'],
]
const TECHNICAL_DETAIL = new RegExp(TECHNICAL_KINDS.map(([pattern]) => pattern.source).join('|'))
const DASHED_CODE_NAME = /\b(?:htpr|yper\d+|hyci|htfe|hefe|inne)-\d+(?:-[a-z0-9]+)+\b/i
const PLAIN_VALENTIN_QUOTE = /Valentin\b(?:\s*,|\s+\([^)\n]{0,48}\))?(?:\s+\d{4}-\d{2}-\d{2})?\s*:\s*["“]|Valentin\s+(?:said|says|wrote|asked|replied)\b[^.\n]{0,24}["“]/i
const TICKET_PARTS = ['Problem', 'Fix', 'Done when', 'Risk', 'Decision'] as const
const QUESTION_PARTS = ['What this is', 'Question', 'My recommendation', 'Why', 'Yes', 'No'] as const

const PLAIN_ADVICE = 'Use short plain sentences for people; put technical details and status in the agent log.'
const TECHNICAL_ADVICE = 'Keep people text plain: say what happened and put the raw value in the agent log.'
const BUILD_LINK_ADVICE = 'Keep people text plain: link the build or commit instead of pasting its id; put the raw value in the agent log.'
const DASHED_CODE_FIX = 'Say what it does in plain words. Put the code name in the agent log.'
const QUOTE_FIX = 'Put his words in a quote block, not in quote marks.'
const QUESTION_FIX = 'Start with What this is. Then at most three plain points. Then Question, My recommendation, Why, Yes and No, each on its own line.'
const PARTS_FIX = 'Add the missing part in plain words. Risk says what can go wrong and how to undo.'

export type AgentWritingRule = {
  id: string
  name: string
  fix: string
  scope: 'line' | 'field' | 'create-description'
}

export const AGENT_WRITING_RULES: AgentWritingRule[] = [
  { id: 'robot-status', name: 'Robot status', fix: PLAIN_ADVICE, scope: 'line' },
  { id: 'technical-detail', name: 'Technical detail', fix: TECHNICAL_ADVICE, scope: 'line' },
  { id: 'dashed-code-name', name: 'Dashed code name', fix: DASHED_CODE_FIX, scope: 'line' },
  { id: 'plain-valentin-quote', name: 'Plain quote', fix: QUOTE_FIX, scope: 'line' },
  { id: 'sentence-length', name: 'Sentence length', fix: PLAIN_ADVICE, scope: 'line' },
  { id: 'question-shape', name: 'Question shape', fix: QUESTION_FIX, scope: 'field' },
  { id: 'ticket-parts', name: 'Ticket parts', fix: PARTS_FIX, scope: 'create-description' },
]

type Hit = { reason: string; offender?: string; fix?: string; legacy?: boolean }

const RULES = new Map(AGENT_WRITING_RULES.map((rule) => [rule.id, rule]))

export class AgentWritingError extends Error {
  readonly status = 400
  readonly code = 'invalid_field'

  constructor(readonly field: string, reason: string, offender?: string, advice = PLAIN_ADVICE, readonly rule?: string) {
    const quoted = excerpt(offender)
    super(`${field}: ${reason}${quoted ? ` ("${quoted}")` : ''}. ${advice}`)
  }
}

export function agentWritingDetails(error: AgentWritingError): { field: string; code: 'agent_writing' } {
  return { field: error.field, code: 'agent_writing' }
}

function excerpt(text: string | undefined): string {
  if (!text) return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat
}

function technicalKind(matched: string): string {
  return TECHNICAL_KINDS.find(([pattern]) => pattern.test(matched))?.[1] ?? 'a technical value'
}

function refusedValue(text: string, index: number, length: number): string {
  let start = index
  let end = index + length
  while (start < end && /\s/.test(text[start])) start += 1
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1
  while (end < text.length && !/\s/.test(text[end])) end += 1
  return text.slice(start, end).replace(/^[("'\u201c]+/, '').replace(/[.,;:!?)"'\u201d]+$/, '')
}

function lines(text: string): string[] {
  return parse(dropBlockquotes(text))
    .structuredText.split('\n').map((line) => line.trim()).filter((line) => line && !FEEDBACK_TALLY_LINE.test(line))
}

function ruleById(id: string): AgentWritingRule {
  const rule = RULES.get(id)
  if (!rule) throw new Error(`Missing writing rule ${id}`)
  return rule
}

const FLAG_RECORD_RULES = new Set(['dashed-code-name', 'plain-valentin-quote'])

function isFlagSwitchRecord(line: string): boolean {
  const words = normalizeVisibleText(line)
  return FLAG_CHAT_RECORD.test(words) && /\bswitch\s+[a-z0-9]+(?:-[a-z0-9]+)*\s+to\s/.test(words)
}

function lineHit(id: string, line: string): Hit | null {
  if (FLAG_RECORD_RULES.has(id) && isFlagSwitchRecord(line)) return null
  const plain = line.replace(/https?:\/\/\S+/g, 'LINK')
  if (id === 'robot-status') {
    const status = plain.match(ROBOT_STATUS) ?? plain.match(BARE_GATE_LABEL)
    return status ? { legacy: true, reason: 'Robot status belongs in the agent log', offender: status[0] } : null
  }
  if (id === 'technical-detail') {
    const detail = plain.match(TECHNICAL_DETAIL)
    if (detail?.index === undefined) return null
    const kind = technicalKind(detail[0])
    return {
      legacy: true,
      reason: `Technical details belong in the agent log: ${kind}`,
      offender: refusedValue(plain, detail.index, detail[0].length),
      fix: kind === BUILD_ID ? BUILD_LINK_ADVICE : TECHNICAL_ADVICE,
    }
  }
  if (id === 'dashed-code-name') {
    const name = plain.match(DASHED_CODE_NAME)
    return name ? { reason: 'a code name belongs in the agent log', offender: name[0] } : null
  }
  if (id === 'plain-valentin-quote') {
    const quote = plain.match(PLAIN_VALENTIN_QUOTE)
    return quote ? { reason: 'Valentin is quoted with quote marks', offender: plain } : null
  }
  if (id === 'sentence-length') {
    for (const sentence of plain.replace(/"[^"]+"|“[^”]+”/g, 'LINK').split(/(?<=[.!?:;])\s+/)) {
      const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}_'’/-]*/gu)?.filter((word) => word !== 'LINK') ?? []
      if (words.length > 12) return { legacy: true, reason: 'Keep each sentence within twelve words', offender: sentence }
    }
  }
  return null
}

function labelPattern(label: string): RegExp {
  return new RegExp(`(?:^|\\s)${label.replace(/\s+/g, '\\s+')}\\s*:`, 'i')
}

function contextPointsBeforeQuestion(html: string): number {
  const beforeQuestion = dropBlockquotes(html).split(/Question\s*:/i)[0] ?? ''
  const lists = beforeQuestion.split(/<\/(?:ul|ol)\s*>/i)
  const closed = lists.slice(0, -1).join(' ').match(/<li\b/gi)?.length ?? 0
  const lastList = lists[lists.length - 1] ?? ''
  const opens = lastList.match(/<li\b/gi)?.length ?? 0
  const closes = lastList.match(/<\/li>/gi)?.length ?? 0
  return closed + (opens > closes ? opens - 1 : opens)
}

function questionHit(html: string): Hit | null {
  const allBlocks = dropBlockquotes(html).split(/(?=<br\s*\/?>|<\/(?:p|li|h[1-6]|div)>)/i)
  const blockTexts = allBlocks.map((block) => parse(stripTags(block)).text)
  const questionAt = blockTexts.findIndex((text) => labelPattern('Question').test(text))
  if (questionAt === -1) return null
  let start = 0
  for (let index = 0; index <= questionAt; index += 1) {
    if (labelPattern('What this is').test(blockTexts[index])) start = index
  }
  const blocks = allBlocks.slice(start)
  const part = blocks.join('')
  const textLines = lines(part)
  const owners = new Map<string, number>()
  blockTexts.slice(start).forEach((text, index) => {
    for (const label of QUESTION_PARTS) {
      if (labelPattern(label).test(text) && !owners.has(label)) owners.set(label, index)
    }
  })
  const placed = QUESTION_PARTS.filter((label) => owners.has(label))
  if (new Set(placed.map((label) => owners.get(label))).size < placed.length) {
    return { reason: 'Question, My recommendation, Why, Yes and No must each be on their own line', offender: 'Question:' }
  }
  for (const label of QUESTION_PARTS) {
    if (!textLines.some((line) => labelPattern(label).test(line))) return { reason: `${label} is missing`, offender: label }
  }
  const questionLine = textLines.find((line) => labelPattern('Question').test(line)) ?? ''
  const questionLabel = questionLine.match(/\bQuestion\s*:/i)
  const asked = questionLabel ? questionLine.slice((questionLabel.index ?? 0) + questionLabel[0].length).trim() : ''
  if (!asked.endsWith('?')) return { reason: 'the question must end with a question mark', offender: questionLine }
  if (contextPointsBeforeQuestion(part) > 3) return { reason: 'keep the context to three points', offender: 'Question:' }
  return null
}

function hasTicketPart(html: string, name: string): boolean {
  const label = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const source = parse(html).structuredText
  return new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${label}\\s*[:.]?(?:\\*\\*)?(?=\\s|$)`, 'i').test(source)
}

function partsHit(html: string): Hit | null {
  const missing = TICKET_PARTS.find((part) => !hasTicketPart(html, part))
  return missing ? { reason: `${missing} is missing`, offender: missing } : null
}

function fail(field: string, id: string, hit: Hit): never {
  const rule = ruleById(id)
  if (hit.legacy) throw new AgentWritingError(field, hit.reason, hit.offender, hit.fix ?? rule.fix, rule.id)
  throw new AgentWritingError(field, `Rule ${rule.name}: ${hit.reason}`, hit.offender, hit.fix ?? rule.fix, rule.id)
}

export type AgentWritingContext = { create?: boolean; houseRules?: boolean; commentEdit?: boolean }

const HOUSE_RULES = new Set(["dashed-code-name", "plain-valentin-quote", "question-shape", "ticket-parts"])

export function assertAgentWriting(
  agentId: string | null | undefined,
  fields: { title?: unknown; description?: unknown; text?: unknown },
  previous: typeof fields = {},
  context: AgentWritingContext = {},
): void {
  if (!agentId) return
  const lineRules = AGENT_WRITING_RULES.filter((rule) => rule.scope === 'line')
  const fieldRules = AGENT_WRITING_RULES.filter((rule) => rule.scope === 'field')
  const createRules = AGENT_WRITING_RULES.filter((rule) => rule.scope === 'create-description')
  for (const field of ['title', 'description', 'text'] as const) {
    const value = fields[field]
    if (typeof value !== 'string') continue
    if (value.length > MAX_CHECK_TEXT_LENGTH) {
      throw new AgentWritingError(field, `Keep text within ${MAX_CHECK_TEXT_LENGTH} characters`)
    }
    const old = previous[field]
    const unchanged = new Set(typeof old === 'string' && old.length <= MAX_CHECK_TEXT_LENGTH ? lines(old) : [])
    const fresh = lines(value).filter((line) => !unchanged.has(line))
    for (const line of fresh) {
      for (const rule of lineRules) {
        if (!context.houseRules && HOUSE_RULES.has(rule.id)) continue
        const hit = lineHit(rule.id, line)
        if (hit) fail(field, rule.id, hit)
      }
    }
    if (context.houseRules && fresh.some((line) => labelPattern('Question').test(line))) {
      for (const rule of fieldRules) {
        const hit = rule.id === 'question-shape' ? questionHit(value) : null
        if (hit) fail(field, rule.id, hit)
      }
    }
    if (context.houseRules && context.create && field === 'description') {
      for (const rule of createRules) {
        const hit = rule.id === 'ticket-parts' ? partsHit(value) : null
        if (hit) fail(field, rule.id, hit)
      }
    }
  }
}
