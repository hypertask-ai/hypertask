import { parse } from 'node-html-parser'

export class AgentWritingError extends Error {
  readonly status = 400
  readonly code = 'invalid_field'

  constructor(readonly field: string, reason: string) {
    super(`${field}: ${reason}. Use short plain sentences for people; put technical details and status in the agent log.`)
  }
}

function lines(text: string): string[] {
  return parse(text)
    .structuredText.split('\n').map((line) => line.trim()).filter(Boolean)
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
      if (/(^|[\s.])(Next|Helpers|Branch\/PR|Branch|PR|Outputs|Claimed|Claim|Released|Gate|Gates|Resume|Session|tmux|Worktree|Ledger)\s*:/i.test(plain)) {
        throw new AgentWritingError(field, 'Robot status belongs in the agent log')
      }
      if (/(^|\s)(~|\.{0,2})\/[\w.-]+\/|\b[\w-]+\.(?:py|sh|zig|ts|tsx|js|mjs|go|kt|json|ya?ml|toml|md|jsonl|log|html)\b|\b[A-Za-z_][\w.]*\(\)|\b[a-z]+(?:_[a-z0-9]+)+\b|\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b|`[^`]+`|\b(?:Traceback|stderr|stdout|exit code|stack trace|tmux)\b|(?:^|\s)--[a-z][\w-]+/.test(plain)) {
        throw new AgentWritingError(field, 'Technical details belong in the agent log')
      }
      for (const sentence of plain.replace(/"[^"]+"|“[^”]+”/g, 'LINK').split(/(?<=[.!?:;])\s+/)) {
        const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}_'’/-]*/gu)?.filter((word) => word !== 'LINK') ?? []
        if (words.length > 12) throw new AgentWritingError(field, 'Keep each sentence within twelve words')
      }
    }
  }
}
