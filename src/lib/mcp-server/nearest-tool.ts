import { DESCRIBE_TOOL_NAME, SEARCH_TOOLS_NAME } from './config/tool-summaries'

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[-.\s]+/g, '_')
}

function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < right.length; j++) {
      next.push(
        Math.min(
          next[j] + 1,
          row[j + 1] + 1,
          row[j] + (left[i] === right[j] ? 0 : 1)
        )
      )
    }
    row = next
  }
  return row[right.length]
}

export function nearestToolName(unknownName: string, accepted: readonly string[]): string | undefined {
  const key = normalise(unknownName)
  if (!key) return undefined
  let best: string | undefined
  let bestDistance = 3
  let tied = false
  for (const candidate of accepted) {
    if (candidate === unknownName) continue
    const distance = editDistance(key, normalise(candidate))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
      tied = false
    } else if (distance === bestDistance) {
      tied = true
    }
  }
  return tied ? undefined : best
}

export function unknownToolMessage(
  unknownName: string,
  accepted: readonly string[],
  hint: boolean
): string {
  const shown = unknownName || '(missing)'
  const base = `Unknown tool ${shown}. Refresh tools/list and choose an advertised tool name`
  if (!hint) return base
  const suggestion = nearestToolName(shown, accepted)
  if (suggestion) return `Unknown tool ${shown}. Did you mean ${suggestion}? Tool names are snake_case; refresh tools/list.`
  const sample = [...accepted].sort()[0]
  const example = sample ? `, like ${sample}` : ''
  return `Unknown tool ${shown}. Tool names are snake_case${example}; refresh tools/list or search it with ${SEARCH_TOOLS_NAME} and ${DESCRIBE_TOOL_NAME}.`
}
