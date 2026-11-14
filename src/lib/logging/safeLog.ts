export type LogId = string | number | boolean | null | Array<string | number | null>

function cls(char: string, digits: boolean, extra: string): boolean {
  const code = char.charCodeAt(0)
  if (digits && code >= 48 && code <= 57) return true
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true
  return extra.includes(char)
}

function emailsInString(text: string): string[] {
  const found: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor)
    if (at < 0) break
    let start = at
    while (start > 0 && cls(text[start - 1], true, "._%+-")) start -= 1
    let end = at + 1
    while (end < text.length && cls(text[end], true, ".-")) end += 1
    const domain = text.slice(at + 1, end)
    const dot = domain.lastIndexOf(".")
    const host = dot >= 0 ? domain.slice(0, dot) : ""
    const suffix = dot >= 0 ? domain.slice(dot + 1) : ""
    let suffixOk = suffix.length >= 2
    for (const char of suffix) if (!cls(char, false, "")) suffixOk = false
    if (start < at && host.length > 0 && !host.startsWith(".") && !host.endsWith(".") && suffixOk) {
      found.push(text.slice(start, end))
    }
    cursor = at + 1
  }
  return found
}

export function emailsIn(value: unknown): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const seenObjects = new WeakSet<object>()
  let nodes = 0
  const walk = (item: unknown, depth: number) => {
    nodes += 1
    if (nodes > 200 || depth > 8) return
    if (typeof item === "string") {
      for (const match of emailsInString(item)) {
        const key = match.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        found.push(match)
      }
      return
    }
    if (typeof item !== "object" || item === null || seenObjects.has(item)) return
    seenObjects.add(item)
    for (const entry of Array.isArray(item) ? item : Object.values(item)) walk(entry, depth + 1)
  }
  walk(value, 0)
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

export function logRecord(label: string, ids: Record<string, LogId>, emailSource?: unknown) {
  const payload: Record<string, unknown> = { ...ids }
  if (emailSource !== undefined) {
    const emails = emailsIn(emailSource)
    if (emails.length > 0) payload.emails = emails
  }
  console.log(label, payload)
}
