export function measuredSizeString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) ? String(size) : null;
}

export function measuredSizeNumber(value: unknown): number | undefined {
  const size = measuredSizeString(value);
  return size === null ? undefined : Number(size);
}
