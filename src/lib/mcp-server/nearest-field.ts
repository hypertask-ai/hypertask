const aliases = new Map([
  ['content', 'text'],
  ['body', 'text'],
  ['comment', 'text'],
  ['message', 'text'],
  ['note', 'text'],
  ['title_text', 'title'],
  ['name', 'title'],
  ['heading', 'title'],
])

export function nearestFieldName(unknownKey: string, accepted: readonly string[]): string | undefined {
  const key = unknownKey.trim().toLowerCase()
  if (accepted.some((field) => field.toLowerCase() === key)) return undefined
  const alias = aliases.get(key)
  if (alias && accepted.includes(alias)) return alias
  let best: string | undefined
  let bestDistance = 3
  let tied = false
  for (const candidate of new Set([...aliases.keys(), ...accepted])) {
    const normalized = candidate.toLowerCase()
    if (key[0] !== normalized[0] || Math.max(key.length, normalized.length) > 1.4 * Math.min(key.length, normalized.length)) continue
    let row = Array.from({ length: normalized.length + 1 }, (_, index) => index)
    for (let i = 0; i < key.length; i++) {
      const next = [i + 1]
      for (let j = 0; j < normalized.length; j++) {
        next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (key[i] === normalized[j] ? 0 : 1)))
      }
      row = next
    }
    const distance = row[normalized.length]
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
      tied = false
    } else if (distance === bestDistance) {
      tied = true
    }
  }
  if (!best || tied) return undefined
  const target = aliases.get(best) ?? best
  return accepted.includes(target) ? target : undefined
}
