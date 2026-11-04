import { parse } from 'node-html-parser'

const ROBOT_STATUS = /(^|[\s.])(Next|Helpers|Branch\/PR|Branch|PR|Outputs|Claimed|Claim|Released|Gate|Gates|Resume|Session|tmux|Worktree|Ledger)\s*:/i
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

const PLAIN_ADVICE = 'Use short plain sentences for people; put technical details and status in the agent log.'
const TECHNICAL_ADVICE = 'Keep people text plain: say what happened and put the raw value in the agent log.'
const BUILD_LINK_ADVICE = 'Keep people text plain: link the build or commit instead of pasting its id; put the raw value in the agent log.'

export class AgentWritingError extends Error {
  readonly status = 400
  readonly code = 'invalid_field'

  constructor(readonly field: string, reason: string, offender?: string, advice = PLAIN_ADVICE) {
    const quoted = excerpt(offender)
    super(`${field}: ${reason}${quoted ? ` ("${quoted}")` : ''}. ${advice}`)
  }
}

function lines(text: string): string[] {
  return parse(text.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, '\n'))
    .structuredText.split('\n').map((line) => line.trim()).filter((line) => line && !FEEDBACK_TALLY_LINE.test(line))
}

export function assertAgentWriting(agentId: string | null | undefined, fields: { title?: unknown; description?: unknown; text?: unknown }, previous: typeof fields = {}): void {
  if (!agentId) return
  for (const field of ['title', 'description', 'text'] as const) {
    const value = fields[field]
    if (typeof value !== 'string') continue
    const old = previous[field]
    const unchanged = new Set(typeof old === 'string' ? lines(old) : [])
    for (const line of lines(value)) {
      if (unchanged.has(line)) continue
      const plain = line.replace(/https?:\/\/\S+/g, 'LINK')
      if (ROBOT_STATUS.test(plain)) {
        throw new AgentWritingError(field, 'Robot status belongs in the agent log', plain.match(ROBOT_STATUS)?.[0])
      }
      const detail = plain.match(TECHNICAL_DETAIL)
      if (detail?.index !== undefined) {
        const kind = technicalKind(detail[0])
        throw new AgentWritingError(field, `Technical details belong in the agent log: ${kind}`, refusedValue(plain, detail.index, detail[0].length), kind === BUILD_ID ? BUILD_LINK_ADVICE : TECHNICAL_ADVICE)
      }
      for (const sentence of plain.replace(/"[^"]+"|“[^”]+”/g, 'LINK').split(/(?<=[.!?:;])\s+/)) {
        const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}_'’/-]*/gu)?.filter((word) => word !== 'LINK') ?? []
        if (words.length > 12) throw new AgentWritingError(field, 'Keep each sentence within twelve words', sentence)
      }
    }
  }
}
