export const RETRY_QUIET_MS = 8000

type Pending = { flush: () => void; cancel: () => void }
const pending = new Map<string, Pending>()

function stable(value: unknown, depth = 0): string {
  if (depth > 6 || value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, depth + 1)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item, depth + 1)}`).join(',')}}`
}

export function failureKey(tool: string, args: unknown): string {
  const text = stable(args)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${tool}:${(hash >>> 0).toString(36)}`
}

export function quietWindowMs(): number {
  const configured = Number(process.env.AI_FEEDBACK_RETRY_QUIET_MS)
  return Number.isFinite(configured) && configured >= 0 ? configured : RETRY_QUIET_MS
}

export function noteSuccess(key: string): boolean {
  const earlier = pending.get(key)
  if (!earlier) return false
  pending.delete(key)
  earlier.cancel()
  return true
}

export function deferFailure(key: string, file: () => Promise<unknown>, windowMs = quietWindowMs()): Promise<void> {
  const earlier = pending.get(key)
  if (earlier) {
    pending.delete(key)
    earlier.flush()
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      pending.delete(key)
      resolve()
    }
    const run = () => {
      void Promise.resolve().then(file).catch(() => {}).finally(finish)
    }
    const timer = setTimeout(run, windowMs)
    pending.set(key, {
      flush: () => { clearTimeout(timer); run() },
      cancel: () => { clearTimeout(timer); finish() },
    })
  })
}

export function pendingFailures(): number {
  return pending.size
}
