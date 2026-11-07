const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export type LogId = string | number | boolean | null | Array<string | number | null>

export function emailsIn(value: unknown): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const seenObjects = new WeakSet<object>()
  const walk = (item: unknown) => {
    if (typeof item === "string") {
      const matches = item.match(EMAIL)
      if (!matches) return
      for (const match of matches) {
        const key = match.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        found.push(match)
      }
      return
    }
    if (typeof item !== "object" || item === null) return
    if (seenObjects.has(item)) return
    seenObjects.add(item)
    const entries = Array.isArray(item) ? item : Object.values(item)
    for (const entry of entries) walk(entry)
  }
  walk(value)
  return found
}

export function recordId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === "string" || typeof id === "number") return String(id)
  }
  return null
}

export function logRecord(
  label: string,
  ids: Record<string, LogId>,
  emailSource?: unknown,
) {
  const payload: Record<string, unknown> = { ...ids }
  if (emailSource !== undefined) {
    const emails = emailsIn(emailSource)
    if (emails.length > 0) payload.emails = emails
  }
  console.log(label, payload)
}
