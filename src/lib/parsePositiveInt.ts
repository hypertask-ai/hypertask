export function parsePositiveInt(
  value: unknown,
  { max = Number.MAX_SAFE_INTEGER, safe = true }: { max?: number; safe?: boolean } = {},
): number | null {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const number = Number(value)
  return Number.isInteger(number) && number > 0 && (!safe || Number.isSafeInteger(number)) && number <= max
    ? number
    : null
}
