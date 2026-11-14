import { waitUntil } from "@vercel/functions"
export const TASK_SAVE_LIMIT_MS = 8_000
export const TASK_SAVE_TOO_LONG = "Saving this ticket took too long. Try again."
const TIMEOUT_TEXT = /timeout exceeded when trying to connect|connection terminated due to connection timeout|timeout expired|canceling statement due to (?:lock|statement) timeout|lock timeout|unable to start a transaction in the given time|transaction.*(?:expired|timed out|timeout)/i
const TIMEOUT_CODES = new Set(["55P03", "57014", "P2024", "TASK_SAVE_TIMEOUT"])
export function isTaskSaveTimeout(error: unknown): boolean {
  const seen = new Set<unknown>()
  const visit = (value: unknown): boolean => {
    if (!value || seen.has(value)) return false
    if (typeof value === "string") return TIMEOUT_TEXT.test(value) || TIMEOUT_CODES.has(value)
    if (typeof value !== "object") return false
    seen.add(value)
    const record = value as { message?: unknown; code?: unknown; meta?: { code?: unknown }; cause?: unknown }
    if (typeof record.code === "string" && TIMEOUT_CODES.has(record.code)) return true
    if (typeof record.meta?.code === "string" && TIMEOUT_CODES.has(record.meta.code)) return true
    if (typeof record.message === "string" && TIMEOUT_TEXT.test(record.message)) return true
    return visit(record.cause)
  }
  return visit(error)
}

export function taskSaveTimeoutResult(): { status: 503; json: { message: string } } {
  return { status: 503, json: { message: TASK_SAVE_TOO_LONG } }
}

function saveTooLong(): Error {
  return Object.assign(new Error(TASK_SAVE_TOO_LONG), { code: "TASK_SAVE_TIMEOUT" })
}

export function taskSaveBudget(deadline = Date.now() + TASK_SAVE_LIMIT_MS) {
  const remaining = () => {
    const ms = deadline - Date.now()
    if (ms <= 0) throw saveTooLong()
    return ms
  }
  return {
    deadline,
    remaining,
    async run<T>(work: () => Promise<T>): Promise<T> {
      const ms = remaining()
      const pending = work()
      waitUntil(pending.catch(() => undefined))
      return finishWithin(pending, ms)
    },
  }
}

export async function fetchTaskSave(url: string, init: RequestInit = {}, deadline = Date.now() + TASK_SAVE_LIMIT_MS): Promise<{ ok: boolean; status: number; data: unknown }> {
  const timeoutMs = deadline - Date.now()
  if (timeoutMs <= 0) throw saveTooLong()
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  try {
    const response = await fetch(url, { ...init, signal })
    if (response.status === 504) throw saveTooLong()
    const data = await response.json().catch((error) => {
      if (signal.aborted) throw error
      return null
    })
    return { ok: response.ok, status: response.status, data }
  } catch (error) {
    if (timeout.aborted) throw saveTooLong()
    throw error
  }
}

export function finishWithin<T>(work: Promise<T>, ms = TASK_SAVE_LIMIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limited = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(saveTooLong()), ms)
    work.then(resolve, reject)
  })
  return limited.finally(() => clearTimeout(timer))
}
