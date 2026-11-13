export const TASK_SAVE_LIMIT_MS = 8_000

export const TASK_SAVE_TOO_LONG = "Saving this ticket took too long. Try again."

const TIMEOUT_TEXT = /timeout exceeded when trying to connect|timeout expired|canceling statement due to (?:lock|statement) timeout|lock timeout/i
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

type SaveLimitTx = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}

export async function applyTaskSaveDbLimits(tx: SaveLimitTx): Promise<void> {
  const limit = String(TASK_SAVE_LIMIT_MS)
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${limit}, true)`
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${limit}, true)`
}

function isTimeoutAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  return name === "TimeoutError" || name === "AbortError"
}

function saveTooLong(): Error {
  return Object.assign(new Error(TASK_SAVE_TOO_LONG), { code: "TASK_SAVE_TIMEOUT" })
}

export async function fetchTaskSave(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(TASK_SAVE_LIMIT_MS)])
    : AbortSignal.timeout(TASK_SAVE_LIMIT_MS)
  try {
    const response = await fetch(url, { ...init, signal })
    if (response.status === 504) throw saveTooLong()
    return response
  } catch (error) {
    if (isTaskSaveTimeout(error)) throw error instanceof Error ? error : saveTooLong()
    if (isTimeoutAbort(error)) throw saveTooLong()
    throw error
  }
}

export function finishWithin<T>(work: Promise<T>, ms = TASK_SAVE_LIMIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limited = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(TASK_SAVE_TOO_LONG), { code: "TASK_SAVE_TIMEOUT" }))
    }, ms)
    work.then(
      (value) => resolve(value),
      (error) => reject(error),
    )
  })
  return limited.finally(() => clearTimeout(timer))
}
